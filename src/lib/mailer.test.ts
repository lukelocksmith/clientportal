/**
 * mailer.ts wysyla maile przez SMTP (nodemailer) i loguje kazda probe do
 * rejestru w bazie (tabela mail_log).
 *
 * `nodemailer` i modul `db` sa tu PODSTAWIONE (`vi.mock`) — prawdziwe wywolanie
 * wyslaloby zaproszenie/alarm na zywy adres przy kazdym uruchomieniu testow,
 * a prawdziwy `db.insert` wymagalby polaczenia z Postgresem. Zero prawdziwej
 * wysylki, zero prawdziwego zapisu — testowana jest wylacznie logika mailer.ts.
 *
 *   npx vitest run src/lib/mailer.test.ts
 */
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'

// `vi.hoisted`, bo `vi.mock` jest wynoszony na sam poczatek pliku — zwykly
// `const` bylby wtedy jeszcze niezainicjalizowany.
const { transportMocks, dbMocks } = vi.hoisted(() => ({
  transportMocks: {
    createTransport: vi.fn(),
    sendMail: vi.fn(),
  },
  dbMocks: {
    insert: vi.fn(),
    values: vi.fn(),
  },
}))

// mailer.ts robi `await import('nodemailer')` (dynamiczny import), ale vi.mock
// przechwytuje modul niezaleznie od tego, czy import jest staticzny czy nie.
vi.mock('nodemailer', () => ({
  createTransport: transportMocks.createTransport,
}))

vi.mock('./db', () => ({
  db: { insert: dbMocks.insert },
}))

vi.mock('./db/schema', () => ({
  // Wartosc bez znaczenia — mockowany `db.insert` i tak ignoruje argument,
  // liczy sie tylko to, ze modul da sie zaimportowac.
  mailLog: {},
}))

import { sendMail, isMailConfigured } from './mailer'

/** Zmienne srodowiskowe, ktore mailer.ts czyta. Zapisujemy/przywracamy je,
 *  zeby testy nie zalezaly od tego, co jest (albo czego nie ma) w .env.local. */
const ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_REPLY_TO'] as const
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]

  vi.clearAllMocks()
  dbMocks.insert.mockReturnValue({ values: dbMocks.values })
  dbMocks.values.mockResolvedValue(undefined)
  transportMocks.createTransport.mockReturnValue({ sendMail: transportMocks.sendMail })
  transportMocks.sendMail.mockResolvedValue({ response: '250 2.0.0 OK', messageId: 'msg-1' })
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

/** Ustawia FIKCYJNE (nie prawdziwe) dane SMTP — same wartosci testowe, zeby
 *  isMailConfigured() zwrocilo true i sendMail probowalo realnie "wyslac". */
function setFakeSmtpConfig() {
  process.env.SMTP_HOST = 'smtp.test.local'
  process.env.SMTP_USER = 'test-user@test.local'
  process.env.SMTP_PASS = 'test-pass-fixture'
}

describe('isMailConfigured', () => {
  it('zwraca false, gdy zadna zmienna SMTP nie jest ustawiona', () => {
    assert.equal(isMailConfigured(), false)
  })

  it('zwraca false, gdy brakuje choc jednej z trzech zmiennych', () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'test-user'
    // SMTP_PASS celowo brak
    assert.equal(isMailConfigured(), false)
  })

  it('zwraca true, gdy wszystkie trzy zmienne sa ustawione', () => {
    setFakeSmtpConfig()
    assert.equal(isMailConfigured(), true)
  })
})

describe('sendMail — brak konfiguracji SMTP (dev bez .env)', () => {
  it('zwraca not-configured i NIE probuje otwierac transportu', async () => {
    const result = await sendMail({ to: 'klient@test.local', subject: 'Test', html: '<p>x</p>' })

    assert.deepEqual(result, { sent: false, reason: 'not-configured' })
    assert.equal(transportMocks.createTransport.mock.calls.length, 0)
    assert.equal(transportMocks.sendMail.mock.calls.length, 0)
  })

  it('mimo braku konfiguracji zapisuje wpis do rejestru z ok=false', async () => {
    await sendMail({
      to: 'klient@test.local',
      subject: 'Reset hasla',
      html: '<p>x</p>',
      kind: 'reset',
      portalId: 'portal-1',
    })

    assert.equal(dbMocks.values.mock.calls.length, 1)
    const inserted = dbMocks.values.mock.calls[0][0]
    assert.equal(inserted.ok, false)
    assert.equal(inserted.kind, 'reset')
    assert.equal(inserted.portalId, 'portal-1')
    assert.equal(inserted.recipient, 'klient@test.local')
    assert.equal(inserted.messageId, null)
    assert.match(inserted.detail, /SMTP/)
  })
})

describe('sendMail — poprawna konfiguracja, SMTP odpowiada OK', () => {
  beforeEach(() => setFakeSmtpConfig())

  it('wysyla maila z podanym adresatem, tematem i trescia HTML/tekst', async () => {
    const result = await sendMail({
      to: 'klient@test.local',
      subject: 'Zaproszenie do portalu',
      html: '<p>Witaj</p>',
      text: 'Witaj',
    })

    assert.deepEqual(result, { sent: true })
    assert.equal(transportMocks.sendMail.mock.calls.length, 1)
    const sentArgs = transportMocks.sendMail.mock.calls[0][0]
    assert.equal(sentArgs.to, 'klient@test.local')
    assert.equal(sentArgs.subject, 'Zaproszenie do portalu')
    assert.equal(sentArgs.html, '<p>Witaj</p>')
    assert.equal(sentArgs.text, 'Witaj')
  })

  it('ustawia domyslny reply-to na hi@important.is, gdy MAIL_REPLY_TO nie jest ustawione', async () => {
    await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })
    const sentArgs = transportMocks.sendMail.mock.calls[0][0]
    assert.equal(sentArgs.replyTo, 'hi@important.is')
  })

  it('nadpisuje reply-to zmienna MAIL_REPLY_TO', async () => {
    process.env.MAIL_REPLY_TO = 'zespol@test.local'
    await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })
    const sentArgs = transportMocks.sendMail.mock.calls[0][0]
    assert.equal(sentArgs.replyTo, 'zespol@test.local')
  })

  it('domyslny port 465 wlacza secure (SMTPS)', async () => {
    await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })
    const transportArgs = transportMocks.createTransport.mock.calls[0][0]
    assert.equal(transportArgs.port, 465)
    assert.equal(transportArgs.secure, true)
  })

  it('port 587 wylacza secure (STARTTLS)', async () => {
    process.env.SMTP_PORT = '587'
    await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })
    const transportArgs = transportMocks.createTransport.mock.calls[0][0]
    assert.equal(transportArgs.port, 587)
    assert.equal(transportArgs.secure, false)
  })

  it('przekazuje dane logowania z env do transportu — sprawdzamy fakt uzycia, nie wartosc sekretu', async () => {
    await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })
    const transportArgs = transportMocks.createTransport.mock.calls[0][0]
    assert.equal(transportArgs.host, process.env.SMTP_HOST)
    assert.equal(transportArgs.auth.user, process.env.SMTP_USER)
    // NIE assertujemy tresci hasla — tylko to, ze cos zostalo przekazane.
    assert.equal(typeof transportArgs.auth.pass, 'string')
    assert.ok(transportArgs.auth.pass.length > 0)
  })

  it('zapisuje do rejestru wpis z ok=true, odpowiedzia SMTP i messageId', async () => {
    transportMocks.sendMail.mockResolvedValueOnce({ response: '250 2.0.0 OK: queued', messageId: '<abc@test>' })
    await sendMail({ to: 'a@test.local', subject: 's', html: 'h', kind: 'panic', portalId: 'portal-2' })

    assert.equal(dbMocks.values.mock.calls.length, 1)
    const inserted = dbMocks.values.mock.calls[0][0]
    assert.equal(inserted.ok, true)
    assert.equal(inserted.detail, '250 2.0.0 OK: queued')
    assert.equal(inserted.messageId, '<abc@test>')
    assert.equal(inserted.kind, 'panic')
    assert.equal(inserted.portalId, 'portal-2')
  })

  it('domyslnie ustawia kind na "invite" i portalId na null, gdy nie podano', async () => {
    await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })
    const inserted = dbMocks.values.mock.calls[0][0]
    assert.equal(inserted.kind, 'invite')
    assert.equal(inserted.portalId, null)
  })
})

describe('sendMail — SMTP rzuca bledem', () => {
  beforeEach(() => setFakeSmtpConfig())

  it('nie wywraca wywolujacego — zwraca sent:false z detalem bledu zamiast rzucac wyjatek', async () => {
    transportMocks.sendMail.mockRejectedValueOnce(new Error('Connection timeout'))

    const result = await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })

    assert.equal(result.sent, false)
    if (!result.sent) {
      assert.equal(result.reason, 'error')
      assert.equal(result.detail, 'Connection timeout')
    }
  })

  it('zapisuje do rejestru wpis z ok=false i detalem bledu', async () => {
    transportMocks.sendMail.mockRejectedValueOnce(new Error('Auth failed'))
    await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })

    const inserted = dbMocks.values.mock.calls[0][0]
    assert.equal(inserted.ok, false)
    assert.equal(inserted.detail, 'Auth failed')
    assert.equal(inserted.messageId, null)
  })

  it('obsluguje odrzucenie, ktore nie jest instancja Error (np. string)', async () => {
    transportMocks.sendMail.mockRejectedValueOnce('boom')

    const result = await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })

    assert.equal(result.sent, false)
    if (!result.sent) assert.equal(result.detail, 'boom')
  })
})

describe('sendMail — odpornosc rejestru na jego wlasne bledy', () => {
  beforeEach(() => setFakeSmtpConfig())

  it('blad zapisu do rejestru NIE zmienia wyniku udanej wysylki', async () => {
    dbMocks.values.mockRejectedValueOnce(new Error('DB down'))

    const result = await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })

    assert.deepEqual(result, { sent: true })
  })

  it('blad zapisu do rejestru NIE zmienia wyniku nieudanej wysylki', async () => {
    transportMocks.sendMail.mockRejectedValueOnce(new Error('Connection refused'))
    dbMocks.values.mockRejectedValueOnce(new Error('DB down'))

    const result = await sendMail({ to: 'a@test.local', subject: 's', html: 'h' })

    assert.equal(result.sent, false)
    if (!result.sent) assert.equal(result.detail, 'Connection refused')
  })
})
