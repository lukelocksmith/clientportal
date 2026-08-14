/**
 * sms.ts wysyla SMS-y przez wlasna bramke SMSGate (telefon firmowy) i loguje
 * kazda probe do rejestru w bazie (tabela sms_log).
 *
 * `fetch` i modul `db` sa tu PODSTAWIONE. Prawdziwe wywolanie wyslaloby SMS-a
 * na zywy numer przy kazdym uruchomieniu testow, a to kosztuje i budzi ludzi.
 * Zero prawdziwej wysylki, zero prawdziwego zapisu.
 *
 *   npx vitest run src/lib/sms.test.ts
 */
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'

const { dbMocks, fetchMock } = vi.hoisted(() => ({
  dbMocks: {
    insert: vi.fn(),
    values: vi.fn(),
  },
  fetchMock: vi.fn(),
}))

vi.mock('./db', () => ({
  db: { insert: dbMocks.insert },
}))

vi.mock('./db/schema', () => ({
  smsLog: {},
}))

import {
  sendSms,
  sendSmsToMany,
  isSmsConfigured,
  normalizePhone,
  parsePhoneList,
  toGsmSafe,
  buildPanicSmsText,
  isWithinThrottleWindow,
} from './sms'

const ENV_KEYS = ['SMSGATE_API_USERNAME', 'SMSGATE_API_PASSWORD', 'SMSGATE_URL'] as const
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]

  vi.clearAllMocks()
  dbMocks.insert.mockReturnValue({ values: dbMocks.values })
  dbMocks.values.mockResolvedValue(undefined)
  // Nowy `Response` przy KAZDYM wywolaniu, nie jeden wspoldzielony: cialo
  // odpowiedzi da sie odczytac tylko raz, wiec przy wysylce do trzech osob
  // drugi i trzeci odbiorca dostawaliby pusta odpowiedz. Prawdziwy fetch
  // tworzy nowa odpowiedz za kazdym razem.
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ id: 'msg-1', state: 'Pending' }), { status: 202 })
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.unstubAllGlobals()
})

/** FIKCYJNE dane bramki, zeby isSmsConfigured() zwrocilo true. */
function setFakeGatewayConfig() {
  process.env.SMSGATE_API_USERNAME = 'test-device'
  process.env.SMSGATE_API_PASSWORD = 'test-pass-fixture'
}

describe('normalizePhone', () => {
  it('sklada numer ze spacjami do formatu E.164', () => {
    assert.strictEqual(normalizePhone('+48 799 255 959'), '+48799255959')
  })

  it('dokleja +48 do samych dziewieciu cyfr, bo tak sa zapisane numery zespolu', () => {
    assert.strictEqual(normalizePhone('502931807'), '+48502931807')
    assert.strictEqual(normalizePhone('502 931 807'), '+48502931807')
  })

  it('zamienia prefiks 00 na +', () => {
    assert.strictEqual(normalizePhone('0048502931807'), '+48502931807')
  })

  it('przyjmuje myslniki i nawiasy', () => {
    assert.strictEqual(normalizePhone('(+48) 502-931-807'), '+48502931807')
  })

  it('odrzuca smiec zamiast go zgadywac', () => {
    assert.strictEqual(normalizePhone(''), null)
    assert.strictEqual(normalizePhone('   '), null)
    assert.strictEqual(normalizePhone('nie-numer'), null)
    // Za krotki na cokolwiek sensownego.
    assert.strictEqual(normalizePhone('12345'), null)
    // Osiem cyfr to nie jest polski numer, a zgadywanie tutaj konczy sie
    // SMS-em do przypadkowej osoby.
    assert.strictEqual(normalizePhone('50293180'), null)
  })
})

describe('parsePhoneList', () => {
  it('rozbija liste po przecinku i pomija puste wpisy', () => {
    assert.deepEqual(parsePhoneList('+48799255959, 502931807 ,, '), ['+48799255959', '+48502931807'])
  })

  it('pusta zmienna daje pusta liste, nie wyjatek', () => {
    assert.deepEqual(parsePhoneList(undefined), [])
    assert.deepEqual(parsePhoneList(''), [])
  })

  it('pomija numery, ktorych nie da sie znormalizowac, i zostawia reszte', () => {
    assert.deepEqual(parsePhoneList('502931807, ala-ma-kota'), ['+48502931807'])
  })

  it('usuwa duplikaty, zeby jedna osoba nie dostala alarmu dwa razy', () => {
    assert.deepEqual(parsePhoneList('502931807, +48 502 931 807'), ['+48502931807'])
  })
})

describe('toGsmSafe', () => {
  /**
   * Powod tej funkcji jest twardy: jeden znak spoza GSM-7 (polski ogonek albo
   * emoji) przelacza CALA wiadomosc na UCS-2, gdzie segment ma 70 znakow
   * zamiast 160. Alarm rozbity na trzy SMS-y dociera w trzech kawalkach i w
   * dowolnej kolejnosci.
   */
  it('zdejmuje polskie ogonki', () => {
    assert.strictEqual(toGsmSafe('zażółć gęślą jaźń'), 'zazolc gesla jazn')
    assert.strictEqual(toGsmSafe('ŁÓDŹ'), 'LODZ')
  })

  it('wyrzuca emoji zamiast zostawiac je w tresci', () => {
    assert.strictEqual(toGsmSafe('🚨 ALARM'), 'ALARM')
  })

  it('zwija powstale po wycieciu podwojne spacje', () => {
    assert.strictEqual(toGsmSafe('ALARM  🚨  teraz'), 'ALARM teraz')
  })

  it('zostawia zwykly tekst bez zmian', () => {
    assert.strictEqual(toGsmSafe('ALARM Onyx: strona nie dziala'), 'ALARM Onyx: strona nie dziala')
  })
})

describe('buildPanicSmsText', () => {
  const base = { portalName: 'Onyx', who: 'Jan Kowalski', message: 'strona nie dziala' }

  it('zawiera projekt, tresc i osobe, bo reakcja to telefon do konkretnego czlowieka', () => {
    const text = buildPanicSmsText(base)
    assert.match(text, /ALARM/)
    assert.match(text, /Onyx/)
    assert.match(text, /strona nie dziala/)
    assert.match(text, /Jan Kowalski/)
  })

  it('miesci sie w jednym segmencie GSM-7 (160 znakow)', () => {
    const text = buildPanicSmsText({
      portalName: 'Bardzo Dluga Nazwa Projektu Klienta',
      who: 'Imie Nazwisko Klienta',
      message: 'x'.repeat(500),
    })
    assert.ok(text.length <= 160, `dlugosc ${text.length} przekracza jeden segment`)
  })

  it('ucina tresc wielokropkiem, gdy nie miesci sie w limicie', () => {
    const text = buildPanicSmsText({ ...base, message: 'a'.repeat(300) })
    assert.match(text, /\.\.\./)
  })

  it('nie przepuszcza znakow spoza GSM-7 z zadnego pola', () => {
    const text = buildPanicSmsText({
      portalName: 'Żółw',
      who: 'Paweł Ćwikła',
      message: '🚨 strona padła',
    })
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(text, /[^\x20-\x7E]/, 'zostal znak, ktory przelaczy SMS na UCS-2')
  })

  it('z linkiem do zadania: link jest w tresci i przezywa ucinanie', () => {
    const text = buildPanicSmsText({
      ...base,
      message: 'x'.repeat(400),
      taskUrl: 'https://app.clickup.com/t/869eeqyxj',
    })
    assert.match(text, /https:\/\/app\.clickup\.com\/t\/869eeqyxj$/)
    assert.ok(text.length <= 160, `dlugosc ${text.length}`)
  })

  it('bez zadania mowi wprost, ze nie powstalo, zamiast milczec', () => {
    // Cisza w tym miejscu bylaby najgorsza: zespol zakladalby, ze zadanie jest
    // na tablicy, a nie byloby go tam wcale.
    assert.match(buildPanicSmsText({ ...base, taskUrl: null }), /NIE powstalo/)
  })

  it('sklada tresc alarmu w jedna linie, bo wieloliniowy SMS czyta sie gorzej', () => {
    const text = buildPanicSmsText({ ...base, message: 'pierwsza linia\ndruga linia' })
    assert.doesNotMatch(text, /\n/)
    assert.match(text, /pierwsza linia druga linia/)
  })
})

describe('isWithinThrottleWindow', () => {
  const now = new Date('2026-08-13T10:00:00Z')

  it('brak wczesniejszego alarmu nie dlawi niczego', () => {
    assert.strictEqual(isWithinThrottleWindow(null, now), false)
    assert.strictEqual(isWithinThrottleWindow(undefined, now), false)
  })

  it('alarm sprzed 2 minut dlawi kolejnego SMS-a', () => {
    assert.strictEqual(isWithinThrottleWindow(new Date('2026-08-13T09:58:00Z'), now), true)
  })

  it('alarm sprzed 30 minut juz nie dlawi', () => {
    assert.strictEqual(isWithinThrottleWindow(new Date('2026-08-13T09:30:00Z'), now), false)
  })

  it('okno da sie zmienic parametrem', () => {
    const przed15min = new Date('2026-08-13T09:45:00Z')
    assert.strictEqual(isWithinThrottleWindow(przed15min, now, 10), false)
    assert.strictEqual(isWithinThrottleWindow(przed15min, now, 20), true)
  })
})

describe('isSmsConfigured', () => {
  it('zwraca false bez zmiennych bramki', () => {
    assert.strictEqual(isSmsConfigured(), false)
  })

  it('zwraca false, gdy brakuje hasla', () => {
    process.env.SMSGATE_API_USERNAME = 'test-device'
    assert.strictEqual(isSmsConfigured(), false)
  })

  it('zwraca true, gdy sa login i haslo', () => {
    setFakeGatewayConfig()
    assert.strictEqual(isSmsConfigured(), true)
  })
})

describe('sendSms — brak konfiguracji bramki (dev bez .env)', () => {
  it('zwraca not-configured i NIE puka do bramki', async () => {
    const result = await sendSms({ to: '502931807', text: 'test' })

    assert.deepEqual(result, { sent: false, reason: 'not-configured' })
    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })

  it('mimo to zapisuje wpis do rejestru z ok=false', async () => {
    await sendSms({ to: '502931807', text: 'test', kind: 'panic', portalId: 'portal-1' })

    assert.strictEqual(dbMocks.values.mock.calls.length, 1)
    const wpis = dbMocks.values.mock.calls[0][0]
    assert.strictEqual(wpis.ok, false)
    assert.strictEqual(wpis.kind, 'panic')
    assert.strictEqual(wpis.portalId, 'portal-1')
    assert.strictEqual(wpis.recipient, '+48502931807')
    assert.match(wpis.detail, /skonfigurowana/i)
  })
})

describe('sendSms — zly numer', () => {
  beforeEach(() => setFakeGatewayConfig())

  it('nie wysyla i mowi wprost, ze numer jest zly', async () => {
    const result = await sendSms({ to: 'nie-numer', text: 'test' })

    assert.strictEqual(result.sent, false)
    if (!result.sent) assert.strictEqual(result.reason, 'invalid-number')
    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })

  it('zapisuje probe do rejestru z surowa wartoscia, zeby dalo sie zobaczyc literowke', async () => {
    await sendSms({ to: 'nie-numer', text: 'test' })

    const wpis = dbMocks.values.mock.calls[0][0]
    assert.strictEqual(wpis.ok, false)
    assert.strictEqual(wpis.recipient, 'nie-numer')
  })
})

describe('sendSms — bramka odpowiada poprawnie', () => {
  beforeEach(() => setFakeGatewayConfig())

  it('strzela POST-em na sciezke prywatnego serwera z Basic Auth', async () => {
    await sendSms({ to: '502931807', text: 'ALARM Onyx' })

    assert.strictEqual(fetchMock.mock.calls.length, 1)
    const [url, init] = fetchMock.mock.calls[0]
    assert.strictEqual(url, 'https://sms.important.is/api/3rdparty/v1/messages')
    assert.strictEqual(init.method, 'POST')
    // Sciezka prywatnego serwera ma dodatkowe /api wzgledem tutoriali dla chmury.
    assert.match(String(url), /\/api\/3rdparty\/v1\/messages$/)
    assert.match(init.headers.Authorization, /^Basic /)
  })

  it('wysyla tresc w polu textMessage.text (format API 1.4x, nie stare "message")', async () => {
    await sendSms({ to: '502931807', text: 'ALARM Onyx' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    assert.deepEqual(body.phoneNumbers, ['+48502931807'])
    assert.strictEqual(body.textMessage.text, 'ALARM Onyx')
  })

  it('pozwala wskazac inna bramke przez SMSGATE_URL', async () => {
    process.env.SMSGATE_URL = 'https://sms-test.important.is'
    await sendSms({ to: '502931807', text: 'x' })

    assert.strictEqual(fetchMock.mock.calls[0][0], 'https://sms-test.important.is/api/3rdparty/v1/messages')
  })

  it('zwraca id wiadomosci i stan, bo Failed w tej bramce jest stanem koncowym', async () => {
    const result = await sendSms({ to: '502931807', text: 'x' })

    assert.deepEqual(result, { sent: true, messageId: 'msg-1', state: 'Pending' })
  })

  it('zapisuje do rejestru id od bramki, tresc i ok=true', async () => {
    await sendSms({ to: '502931807', text: 'ALARM Onyx', kind: 'panic', portalId: 'portal-2' })

    const wpis = dbMocks.values.mock.calls[0][0]
    assert.strictEqual(wpis.ok, true)
    assert.strictEqual(wpis.providerMessageId, 'msg-1')
    assert.strictEqual(wpis.state, 'Pending')
    assert.strictEqual(wpis.text, 'ALARM Onyx')
    assert.strictEqual(wpis.portalId, 'portal-2')
  })
})

describe('sendSms — bramka odmawia albo milczy', () => {
  beforeEach(() => setFakeGatewayConfig())

  it('status 4xx to blad z trescia odpowiedzi w detalu, nie cichy sukces', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))

    const result = await sendSms({ to: '502931807', text: 'x' })

    assert.strictEqual(result.sent, false)
    if (!result.sent) {
      assert.strictEqual(result.reason, 'error')
      assert.match(result.detail!, /401/)
      assert.match(result.detail!, /unauthorized/)
    }
  })

  it('zerwane polaczenie nie wywraca wolajacego', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'))

    const result = await sendSms({ to: '502931807', text: 'x' })

    assert.strictEqual(result.sent, false)
    if (!result.sent) assert.strictEqual(result.detail, 'fetch failed')
  })

  it('odpowiedz 200 bez id jest traktowana jak blad, bo nie da sie jej pozniej sprawdzic', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'Pending' }), { status: 202 }))

    const result = await sendSms({ to: '502931807', text: 'x' })

    assert.strictEqual(result.sent, false)
    if (!result.sent) assert.match(result.detail!, /id/i)
  })

  it('blad zapisu do rejestru NIE zmienia wyniku wysylki', async () => {
    dbMocks.values.mockRejectedValueOnce(new Error('DB down'))

    const result = await sendSms({ to: '502931807', text: 'x' })

    assert.strictEqual(result.sent, true)
  })
})

describe('sendSmsToMany', () => {
  beforeEach(() => setFakeGatewayConfig())

  it('jeden zly numer nie blokuje pozostalych odbiorcow', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'))

    const wyniki = await sendSmsToMany({
      to: ['502931807', '799255959', '697792238'],
      text: 'ALARM',
      kind: 'panic',
    })

    assert.strictEqual(wyniki.length, 3)
    assert.strictEqual(wyniki.filter(r => r.sent).length, 2)
    assert.strictEqual(fetchMock.mock.calls.length, 3)
  })

  it('pusta lista odbiorcow niczego nie wysyla', async () => {
    const wyniki = await sendSmsToMany({ to: [], text: 'ALARM' })

    assert.deepEqual(wyniki, [])
    assert.strictEqual(fetchMock.mock.calls.length, 0)
  })
})
