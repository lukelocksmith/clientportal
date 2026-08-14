import { describe, it, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { panicAlerts, smsLog } from '@/lib/db/schema'
import { isDbReachable, createTestPortal, dropTestPortal } from './helpers'

/**
 * Eskalacja alarmu bez reakcji, na prawdziwej bazie.
 *
 * Podstawione jest WYLACZNIE wyjscie na swiat: ClickUp (`getTask`), poczta
 * (`mailer`) i `fetch` (bramka SMS oraz webhook Discorda). Reszta jest
 * prawdziwa, bo pytanie brzmi "czy portal po 25 minutach faktycznie kogos
 * obudzi i czy zrobi to DOKLADNIE RAZ", a na to nie odpowie atrapa bazy.
 *
 * Czas plynie tu przez wsteczne daty `created_at`, a nie przez czekanie.
 *
 *   docker start cp-test-pg && npx vitest run tests/integration/routes.panicEscalation.test.ts
 */
const { clickup, mailer, fetchMock } = vi.hoisted(() => ({
  clickup: { getTask: vi.fn() },
  mailer: { sendMail: vi.fn() },
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/mailer', () => mailer)

import { NextRequest } from 'next/server'
import { GET as escalationGET } from '@/app/api/cron/panic-escalation/route'

const dbUp = await isDbReachable()

/** Paulina w workspace klientow: osoba dyzurna, przypisywana automatycznie. */
const PAULINA = 94729587
/** Filip: ktokolwiek inny. */
const FILIP = 44435339

const CRON_SECRET = 'test-cron-secret-fixture'
const DISCORD_WEBHOOK = 'https://discord.test/webhook/alarmy'

const cronReq = (token = CRON_SECRET) =>
  new NextRequest(`http://localhost/api/cron/panic-escalation?token=${token}`)

/** Zadanie z ClickUpa w minimalnym ksztalcie, ktorego uzywa eskalacja. */
const IMIONA: Record<number, string> = { 94729587: 'Paulina', 44435339: 'Filip Gorny' }
const task = (assignees: number[], status: string) => ({
  id: 'task-1',
  assignees: assignees.map(id => ({ id, username: IMIONA[id] ?? 'Ktos' })),
  status: { status },
})

const smsCalls = () =>
  fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/3rdparty/v1/messages'))
const discordCalls = () => fetchMock.mock.calls.filter(c => String(c[0]) === DISCORD_WEBHOOK)

describe.skipIf(!dbUp)('POST /api/cron/panic-escalation', () => {
  const ENV_KEYS = [
    'CRON_SECRET',
    'PANIC_SMS_TO',
    'PANIC_EMAIL_TO',
    'PANIC_DISCORD_WEBHOOK_URL',
    'SMSGATE_API_USERNAME',
    'SMSGATE_API_PASSWORD',
    'PANIC_ASSIGNEE_CLICKUP_ID',
  ] as const
  let savedEnv: Record<string, string | undefined>
  let portal: { id: string; slug: string }

  beforeAll(async () => {
    portal = await createTestPortal('esk')
  })

  afterAll(async () => {
    if (portal) await dropTestPortal(portal.id)
  })

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
    process.env.CRON_SECRET = CRON_SECRET
    process.env.PANIC_SMS_TO = '555111222'
    process.env.PANIC_EMAIL_TO = 'zespol@test.local'
    process.env.PANIC_DISCORD_WEBHOOK_URL = DISCORD_WEBHOOK
    process.env.SMSGATE_API_USERNAME = 'test-device'
    process.env.SMSGATE_API_PASSWORD = 'test-pass-fixture'
    process.env.PANIC_ASSIGNEE_CLICKUP_ID = String(PAULINA)

    vi.clearAllMocks()
    mailer.sendMail.mockResolvedValue({ sent: true })
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ id: 'sms-1', state: 'Pending' }), { status: 202 })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    vi.unstubAllGlobals()
    await db.delete(smsLog).where(eq(smsLog.portalId, portal.id))
    await db.delete(panicAlerts).where(eq(panicAlerts.portalId, portal.id))
  })

  /** Alarm sprzed `minutTemu` minut, opcjonalnie juz raz eskalowany. */
  async function alarmSprzed(input: {
    minutTemu: number
    escalationCount?: number
    clickupTaskId?: string | null
  }): Promise<string> {
    const [row] = await db
      .insert(panicAlerts)
      .values({
        portalId: portal.id,
        userEmail: 'klient@test.local',
        userName: 'Klient Testowy',
        message: 'strona nie dziala',
        clickupTaskId: input.clickupTaskId === undefined ? 'task-1' : input.clickupTaskId,
        escalationCount: input.escalationCount ?? 0,
        createdAt: new Date(Date.now() - input.minutTemu * 60_000),
      })
      .returning({ id: panicAlerts.id })
    return row.id
  }

  const stan = async (id: string) => {
    const [row] = await db.select().from(panicAlerts).where(eq(panicAlerts.id, id))
    return row
  }

  it('cudzy token nie uruchamia niczego', async () => {
    await alarmSprzed({ minutTemu: 30 })
    clickup.getTask.mockResolvedValue(task([PAULINA], 'do zrobienia'))

    const res = await escalationGET(cronReq('nie-ten-token'))

    assert.strictEqual(res.status, 401)
    assert.strictEqual(fetchMock.mock.calls.length, 0)
    assert.strictEqual(clickup.getTask.mock.calls.length, 0)
  })

  it('alarm sprzed 10 minut jest za swiezy — nikt nie jest budzony', async () => {
    await alarmSprzed({ minutTemu: 10 })
    clickup.getTask.mockResolvedValue(task([PAULINA], 'do zrobienia'))

    const res = await escalationGET(cronReq())

    assert.strictEqual(res.status, 200)
    assert.strictEqual((await res.json()).checked, 0)
    assert.strictEqual(smsCalls().length, 0)
  })

  it('po 25 minutach z sama Paulina w "do zrobienia" idzie SMS, Discord i mail', async () => {
    const id = await alarmSprzed({ minutTemu: 26 })
    clickup.getTask.mockResolvedValue(task([PAULINA], 'do zrobienia'))

    const res = await escalationGET(cronReq())
    const body = await res.json()

    assert.strictEqual(body.escalated, 1)
    assert.strictEqual(smsCalls().length, 1, 'SMS do jedynego numeru z PANIC_SMS_TO')
    assert.strictEqual(discordCalls().length, 1)
    assert.strictEqual(mailer.sendMail.mock.calls.length, 1)

    const sms = JSON.parse(String((smsCalls()[0][1] as RequestInit).body))
    assert.match(sms.textMessage.text, /PONOWNIE/)
    assert.match(sms.textMessage.text, /app\.clickup\.com\/t\/task-1/, 'link do zadania jest obowiazkowy')

    const po = await stan(id)
    assert.strictEqual(po.escalationCount, 1)
    assert.ok(po.escalatedAt, 'zapisany moment eskalacji')
  })

  it('ktos inny przypisany ORAZ zadanie w trakcie: zamiast eskalacji leci "przejete"', async () => {
    const id = await alarmSprzed({ minutTemu: 26 })
    clickup.getTask.mockResolvedValue(task([PAULINA, FILIP], 'w trakcie'))

    const res = await escalationGET(cronReq())

    assert.strictEqual((await res.json()).escalated, 0, 'to nie jest eskalacja')
    const po = await stan(id)
    assert.strictEqual(po.escalationCount, 0, 'licznik eskalacji nietkniety')
    assert.ok(po.handledAt, 'sprawa ostemplowana jako przejeta')
    assert.strictEqual(po.handledBy, 'Filip Gorny', 'zapisane KTO przejal, z ClickUpa')

    // Powiadomienie idzie trzema kanalami, tak jak alarm.
    assert.strictEqual(smsCalls().length, 1)
    assert.strictEqual(discordCalls().length, 1)
    assert.strictEqual(mailer.sendMail.mock.calls.length, 1)
    const sms = JSON.parse(String((smsCalls()[0][1] as RequestInit).body))
    assert.match(sms.textMessage.text, /PRZEJETE/)
    assert.match(sms.textMessage.text, /Filip Gorny/)
  })

  it('powiadomienie o przejeciu idzie DOKLADNIE RAZ, kolejny przebieg milczy', async () => {
    await alarmSprzed({ minutTemu: 26 })
    clickup.getTask.mockResolvedValue(task([PAULINA, FILIP], 'w trakcie'))

    await escalationGET(cronReq())
    const poPierwszym = smsCalls().length
    await escalationGET(cronReq())

    assert.strictEqual(smsCalls().length, poPierwszym, 'stempel handled_at zdusil powtorke')
  })

  it('przejeta sprawa wypada z kolejki, wiec druga eskalacja po 50 min juz nie przyjdzie', async () => {
    const id = await alarmSprzed({ minutTemu: 51, escalationCount: 1 })
    clickup.getTask.mockResolvedValue(task([FILIP], 'w trakcie'))

    await escalationGET(cronReq())
    const poPrzejeciu = smsCalls().length
    // Symulujemy kolejny przebieg crona po dalszych minutach.
    await escalationGET(cronReq())

    assert.strictEqual(smsCalls().length, poPrzejeciu)
    assert.strictEqual((await stan(id)).escalationCount, 1, 'licznik eskalacji sie nie podnosi po przejeciu')
  })

  it('sam Filip przypisany, ale zadanie stoi w "do zrobienia" — nadal budzimy', async () => {
    await alarmSprzed({ minutTemu: 26 })
    clickup.getTask.mockResolvedValue(task([FILIP], 'do zrobienia'))

    const res = await escalationGET(cronReq())

    assert.strictEqual((await res.json()).escalated, 1)
    assert.strictEqual(smsCalls().length, 1)
  })

  it('drugi przebieg crona zaraz po pierwszym NIE wysyla tego samego drugi raz', async () => {
    const id = await alarmSprzed({ minutTemu: 26 })
    clickup.getTask.mockResolvedValue(task([PAULINA], 'do zrobienia'))

    await escalationGET(cronReq())
    const poPierwszym = smsCalls().length
    await escalationGET(cronReq())

    assert.strictEqual(smsCalls().length, poPierwszym, 'licznik w bazie zdusil powtorke')
    assert.strictEqual((await stan(id)).escalationCount, 1)
  })

  it('po 50 minutach idzie druga i ostatnia eskalacja', async () => {
    const id = await alarmSprzed({ minutTemu: 51, escalationCount: 1 })
    clickup.getTask.mockResolvedValue(task([PAULINA], 'do zrobienia'))

    await escalationGET(cronReq())

    assert.strictEqual(smsCalls().length, 1)
    assert.strictEqual((await stan(id)).escalationCount, 2)
  })

  it('po dwoch eskalacjach portal milknie, nawet po godzinach', async () => {
    await alarmSprzed({ minutTemu: 300, escalationCount: 2 })
    clickup.getTask.mockResolvedValue(task([PAULINA], 'do zrobienia'))

    const res = await escalationGET(cronReq())

    assert.strictEqual((await res.json()).checked, 0)
    assert.strictEqual(smsCalls().length, 0)
  })

  it('brak zadania w ClickUpie tez jest powodem do eskalacji, i mowi o tym wprost', async () => {
    await alarmSprzed({ minutTemu: 26, clickupTaskId: null })

    const res = await escalationGET(cronReq())

    assert.strictEqual((await res.json()).escalated, 1)
    assert.strictEqual(clickup.getTask.mock.calls.length, 0, 'nie ma czego pytac')
    const sms = JSON.parse(String((smsCalls()[0][1] as RequestInit).body))
    assert.match(sms.textMessage.text, /NIE powstalo/)
  })

  it('padniety ClickUp znaczy "nie wiem", a niewiedza przy alarmie budzi', async () => {
    await alarmSprzed({ minutTemu: 26 })
    clickup.getTask.mockRejectedValue(new Error('ClickUp 500'))

    const res = await escalationGET(cronReq())
    const body = await res.json()

    assert.strictEqual(body.escalated, 1)
    assert.match(body.results[0].reason, /ClickUp nie odpowiedział/)
  })

  it('nieudana bramka SMS nie przerywa przebiegu ani nie cofa licznika', async () => {
    const id = await alarmSprzed({ minutTemu: 26 })
    clickup.getTask.mockResolvedValue(task([PAULINA], 'do zrobienia'))
    fetchMock.mockRejectedValue(new Error('bramka nie odpowiada'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await escalationGET(cronReq())

    assert.strictEqual(res.status, 200)
    // Mail idzie osobnym kanalem, wiec padnieta bramka go nie dotyka.
    assert.strictEqual(mailer.sendMail.mock.calls.length, 1)
    assert.strictEqual((await stan(id)).escalationCount, 1)
    const wpisy = await db.select().from(smsLog).where(eq(smsLog.portalId, portal.id))
    assert.ok(wpisy.length >= 1 && wpisy.every(w => !w.ok), 'nieudana proba jest w rejestrze')
    errorSpy.mockRestore()
  })

  it('alarm sprzed doby jest juz poza zasiegiem, zeby wlaczony po przerwie cron nie zasypal zespolu', async () => {
    await alarmSprzed({ minutTemu: 60 * 25 })
    clickup.getTask.mockResolvedValue(task([PAULINA], 'do zrobienia'))

    const res = await escalationGET(cronReq())

    assert.strictEqual((await res.json()).checked, 0)
    assert.strictEqual(smsCalls().length, 0)
  })
})
