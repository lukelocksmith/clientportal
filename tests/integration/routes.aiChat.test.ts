import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog, aiUsage, aiChatLogs, portals } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUserWithPassword,
  createTestList,
} from './helpers'

/**
 * CZAT AI — trasa, przez ktora MODEL zaklada zadania w ClickUpie klienta.
 *
 * Sama odpowiedz jest strumieniem, wiec nie o nia tu chodzi. Cala logika warta
 * pilnowania siedzi w narzedziu `createTask` przekazanym do `streamText`:
 * to ono decyduje, na ktora liste trafi zadanie, jaka dostanie stopke i ktore
 * tagi przejda. Model dostaje w tych miejscach swobodne pola tekstowe, a jego
 * wyjscie podlega halucynacji i podpowiedziom z rozmowy klienta.
 *
 * Dlatego pakiet `ai` jest podstawiony tak, zeby PRZECHWYCIC to narzedzie
 * i wywolac je wprost. Zadnego modelu ani zadnego providera w tych testach nie
 * ma; jest za to prawdziwy Postgres, prawdziwa sesja i prawdziwy zapis
 * do audit_log oraz ai_usage.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
type NarzedzieTworzenia = {
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

const { cookieJar, ai, clickup, cache, providers } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  ai: {
    przechwycone: { tools: undefined as Record<string, NarzedzieTworzenia> | undefined, opcje: undefined as Record<string, unknown> | undefined },
    onEnd: undefined as ((arg: { usage: unknown; steps?: unknown; finishReason?: string }) => Promise<void>) | undefined,
  },
  clickup: { createTask: vi.fn() },
  cache: { invalidateFolderTasks: vi.fn() },
  providers: { model: { nazwa: 'atrapa-modelu' } },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value) },
    delete: (name: string) => { cookieJar.delete(name) },
  })),
}))

vi.mock('ai', () => ({
  // `tool()` w prawdziwym pakiecie tylko opisuje narzedzie, wiec zwrocenie
  // argumentu bez zmian jest wierne, a przy okazji daje nam dostep do `execute`.
  tool: (definicja: unknown) => definicja,
  isStepCount: () => () => false,
  convertToModelMessages: async (m: unknown) => m,
  streamText: (opcje: Record<string, unknown>) => {
    ai.przechwycone.tools = opcje.tools as Record<string, NarzedzieTworzenia>
    ai.przechwycone.opcje = opcje
    // `onFinish` jest w ai 7 przestarzale; trasa uzywa `onEnd`. Bierzemy
    // jedno albo drugie, zeby test nie przestal niczego sprawdzac po cichu,
    // gdyby nazwa znow sie zmienila.
    ai.onEnd = (opcje.onEnd ?? opcje.onFinish) as (arg: { usage: unknown; steps?: unknown }) => Promise<void>
    return { toUIMessageStreamResponse: () => new Response('strumien') }
  },
}))

vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: () => () => providers.model }))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: () => () => providers.model }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => providers.model }))
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => ({ chat: () => providers.model }),
}))
vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/clickupCache', () => ({ ...cache, folderTasksTag: (id: string) => `f-${id}` }))

import { NextRequest } from 'next/server'
import { createSession, setSessionCookie } from '@/lib/auth'
import { AWARIA_TAG } from '@/lib/utils'
import { POST as chatPOST } from '@/app/api/ai/chat/route'

const dbUp = await isDbReachable()

const zadanie = (body: unknown) =>
  new NextRequest('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as ConstructorParameters<typeof NextRequest>[1])

describe.skipIf(!dbUp)('czat AI na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }
  let userA: string
  const emailA = `ai-${Math.random().toString(36).slice(2, 8)}@example.com`

  beforeAll(async () => {
    portalA = await createTestPortal('ai-a')
    portalB = await createTestPortal('ai-b')
    userA = await createTestUserWithPassword({
      portalId: portalA.id, email: emailA, password: 'jakies-haslo-1', name: 'Anna Klient',
    })
    await createTestList({ portalId: portalA.id, clickupListId: 'lista-domyslna', isDefault: true })
    await createTestList({ portalId: portalA.id, clickupListId: 'lista-druga' })
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
  })

  beforeEach(async () => {
    cookieJar.clear()
    vi.clearAllMocks()
    ai.przechwycone.tools = undefined
    ai.onEnd = undefined
    clickup.createTask.mockResolvedValue({ id: 'ai-1', name: 'Zadanie z czatu', url: 'https://cu.test/1' })
    cache.invalidateFolderTasks.mockResolvedValue(undefined)
  })

  async function zaloguj(): Promise<void> {
    await setSessionCookie(await createSession(userA, '127.0.0.1', 'vitest'))
  }

  const rozmowa = (slug: string) => ({
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'przycisk nie dziala' }] }],
    slug,
    mode: 'new-task',
  })

  /** Uruchamia trase i oddaje przechwycone narzedzie tworzenia zadania. */
  async function narzedzie(slug: string): Promise<NarzedzieTworzenia> {
    await chatPOST(zadanie(rozmowa(slug)))
    const t = ai.przechwycone.tools?.createTask
    assert.ok(t, 'narzedzie createTask nie zostalo przekazane do streamText')
    return t!
  }

  describe('brama', () => {
    it('bez sesji -> 401 i model nie jest w ogole uruchamiany', async () => {
      const res = await chatPOST(zadanie(rozmowa(portalA.slug)))

      assert.strictEqual(res.status, 401)
      assert.strictEqual(ai.przechwycone.tools, undefined, 'streamText nie zostal zawolany')
    })

    it('klient portalu A nie porozmawia w imieniu portalu B', async () => {
      await zaloguj()

      const res = await chatPOST(zadanie(rozmowa(portalB.slug)))

      assert.strictEqual(res.status, 401)
      assert.strictEqual(ai.przechwycone.tools, undefined)
    })

    it('bez sluga -> 400', async () => {
      await zaloguj()

      const res = await chatPOST(zadanie({ ...rozmowa(portalA.slug), slug: undefined }))

      assert.strictEqual(res.status, 400)
    })

    it('tryb inny niz new-task -> 403, sprawdzony PRZED sesja', async () => {
      const res = await chatPOST(zadanie({ ...rozmowa(portalA.slug), mode: 'dowolny-inny' }))

      // Pozostale tryby sa wylaczone, wiec odmowa nie wymaga nawet zapytania
      // bazy o sesje.
      assert.strictEqual(res.status, 403)
    })

    it('zalogowany klient dostaje strumien', async () => {
      await zaloguj()

      const res = await chatPOST(zadanie(rozmowa(portalA.slug)))

      assert.strictEqual(res.status, 200)
      assert.ok(ai.przechwycone.tools?.createTask, 'narzedzie tworzenia zadania jest dostepne')
    })
  })

  /**
   * NARZEDZIE `createTask`. Model dostaje tu swobodne pola tekstowe, wiec
   * kazde z ponizszych ograniczen istnieje po to, zeby jego wyjscie nie stalo
   * sie danymi wejsciowymi systemu.
   */
  describe('narzedzie tworzenia zadania', () => {
    it('zadanie ląduje na LISCIE PORTALU i w statusie „do zrobienia"', async () => {
      await zaloguj()
      const t = await narzedzie(portalA.slug)

      await t.execute({ name: 'Poprawic przycisk', description: 'nie klika sie' })

      assert.strictEqual(clickup.createTask.mock.calls[0][0], 'lista-domyslna')
      // Zgloszenia klienta trafiaja do „do zrobienia", nie do backlogu, zeby
      // zespol je widzial, zamiast zeby zostaly zasypane.
      assert.strictEqual(clickup.createTask.mock.calls[0][1].status, 'do zrobienia')
    })

    it('lista SPOZA portalu jest odrzucana i spada na domyslna', async () => {
      await zaloguj()
      const t = await narzedzie(portalA.slug)

      await t.execute({ name: 'X', description: 'y', listId: 'lista-innego-klienta' })

      // Identyfikator listy pochodzi od modelu, wiec nie moze byc zaufany:
      // inaczej halucynacja albo podpowiedz z rozmowy zalozylaby zadanie
      // w projekcie innego klienta.
      assert.strictEqual(clickup.createTask.mock.calls[0][0], 'lista-domyslna')
    })

    it('lista NALEZACA do portalu jest respektowana', async () => {
      await zaloguj()
      const t = await narzedzie(portalA.slug)

      await t.execute({ name: 'X', description: 'y', listId: 'lista-druga' })

      assert.strictEqual(clickup.createTask.mock.calls[0][0], 'lista-druga')
    })

    it('stopka z autorem pochodzi z SESJI, nie z tresci od modelu', async () => {
      await zaloguj()
      const t = await narzedzie(portalA.slug)

      await t.execute({
        name: 'X',
        description: 'Zgłaszający: Jan Podszywacz <jan@obcy.example>',
      })

      const opis = clickup.createTask.mock.calls[0][1].description as string
      // Prompt prosi model o „zglaszajacego" w opisie, ale to jest tekst
      // generowany, wiec podlega halucynacji i podpowiedziom z rozmowy.
      // Atrybucja musi pochodzic z sesji, jednym sposobem dla wszystkich kanalow.
      assert.ok(opis.includes(emailA), 'stopka niesie adres z sesji')
      assert.ok(opis.includes('Anna Klient'), 'stopka niesie imie z sesji')
    })

    it('z tagow proponowanych przez model przechodzi WYLACZNIE tag awarii', async () => {
      await zaloguj()
      const t = await narzedzie(portalA.slug)

      await t.execute({
        name: 'X',
        description: 'y',
        tags: ['pilne', 'super-wazne', 'faktura', 'cokolwiek-z-halucynacji'],
      })

      // Tagi w ClickUpie sa WSPOLNE dla calej przestrzeni klientow, wiec bez
      // tego filtra kazda halucynacja zakladalaby zespolowi smieci w slowniku.
      assert.strictEqual(clickup.createTask.mock.calls[0][1].tags, undefined)
    })

    it('tag awarii przechodzi i podnosi priorytet zgloszenia', async () => {
      await zaloguj()
      const t = await narzedzie(portalA.slug)

      await t.execute({ name: 'Strona lezy', description: 'nic nie dziala', tags: [AWARIA_TAG] })

      assert.deepStrictEqual(clickup.createTask.mock.calls[0][1].tags, [AWARIA_TAG])
    })

    it('tagi skonfigurowane dla portalu (autoTags) doklejaja sie do kazdego zadania z czatu', async () => {
      await db.update(portals).set({ autoTags: 'asana,portal' }).where(eq(portals.id, portalA.id))
      try {
        await zaloguj()
        const t = await narzedzie(portalA.slug)

        await t.execute({ name: 'X', description: 'y' })

        assert.deepStrictEqual(clickup.createTask.mock.calls[0][1].tags, ['asana', 'portal'])
      } finally {
        await db.update(portals).set({ autoTags: null }).where(eq(portals.id, portalA.id))
      }
    })

    it('autoTags i tag awarii wspolistnieja, bez duplikatow', async () => {
      await db.update(portals).set({ autoTags: 'asana,awaria' }).where(eq(portals.id, portalA.id))
      try {
        await zaloguj()
        const t = await narzedzie(portalA.slug)

        await t.execute({ name: 'Strona lezy', description: 'y', tags: [AWARIA_TAG] })

        // "awaria" jest i w konfiguracji portalu, i w tagach od modelu — ma
        // wejsc do ClickUpa raz, nie dwa razy.
        assert.deepStrictEqual(clickup.createTask.mock.calls[0][1].tags, ['asana', 'awaria'])
      } finally {
        await db.update(portals).set({ autoTags: null }).where(eq(portals.id, portalA.id))
      }
    })

    it('bez autoTags i bez awarii nie wysyla pola tags wcale', async () => {
      await zaloguj()
      const t = await narzedzie(portalA.slug)

      await t.execute({ name: 'X', description: 'y' })

      assert.strictEqual(clickup.createTask.mock.calls[0][1].tags, undefined)
    })

    it('utworzenie zadania uniewaznia bufor tablicy i zapisuje zdarzenie', async () => {
      await zaloguj()
      // Wlasny identyfikator zadania: `audit_log` gromadzi wpisy z calego pliku,
      // a atrapa domyslnie oddaje wszedzie to samo `ai-1`.
      const idZadania = `ai-historia-${Math.random().toString(36).slice(2, 8)}`
      clickup.createTask.mockResolvedValue({ id: idZadania, name: 'Do historii', url: null })
      const t = await narzedzie(portalA.slug)

      await t.execute({ name: 'Do historii', description: 'y' })

      // Bez uniewaznienia klient zglosilby zadanie, odswiezyl strone i nie
      // zobaczylby go przez kilkadziesiat sekund.
      assert.strictEqual(cache.invalidateFolderTasks.mock.calls.length, 1)

      const wpisy = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.portalId, portalA.id), eq(auditLog.resourceId, idZadania)))
      assert.strictEqual(wpisy.length, 1)
      assert.strictEqual(JSON.parse(wpisy[0].meta!).source, 'ai')
    })

    it('brak skonfigurowanej listy konczy sie komunikatem, nie wyjatkiem', async () => {
      const bezList = await createTestPortal('ai-nolist')
      try {
        const user = await createTestUserWithPassword({
          portalId: bezList.id, email: `nolist-${Math.random().toString(36).slice(2, 8)}@example.com`,
          password: 'haslo-jakies-1',
        })
        await setSessionCookie(await createSession(user, '127.0.0.1', 'vitest'))
        const t = await narzedzie(bezList.slug)

        const wynik = await t.execute({ name: 'X', description: 'y' })

        assert.ok(wynik.error, 'model dostaje zrozumialy komunikat zamiast bledu')
        assert.strictEqual(clickup.createTask.mock.calls.length, 0)
      } finally {
        await dropTestPortal(bezList.id)
      }
    })
  })

  describe('rozliczenie zuzycia', () => {
    it('zuzycie zapisuje sie z kosztem i adresem uzytkownika', async () => {
      await zaloguj()
      await chatPOST(zadanie(rozmowa(portalA.slug)))

      assert.ok(ai.onEnd, 'trasa podpiela sie pod zakonczenie strumienia')
      await ai.onEnd!({ usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 } })

      const [wpis] = await db.select().from(aiUsage).where(eq(aiUsage.portalId, portalA.id))
      assert.ok(wpis, 'zuzycie odnotowane')
      assert.strictEqual(wpis.inputTokens, 1000)
      assert.strictEqual(wpis.outputTokens, 500)
      assert.strictEqual(wpis.userEmail, emailA)
      assert.ok(Number(wpis.costUsd) >= 0, 'koszt policzony z cennika')
    })

    it('starsze nazwy pol zuzycia tez sa rozumiane', async () => {
      await zaloguj()
      await chatPOST(zadanie(rozmowa(portalA.slug)))

      // Pakiet `ai` zmienial nazwy tych pol miedzy wersjami. Ciche zero
      // w rozliczeniu byloby gorsze od bledu, bo wygladaloby na brak uzycia.
      await ai.onEnd!({ usage: { promptTokens: 700, completionTokens: 300 } })

      const wpisy = await db.select().from(aiUsage).where(eq(aiUsage.portalId, portalA.id))
      const ostatni = wpisy[wpisy.length - 1]
      assert.strictEqual(ostatni.inputTokens, 700)
      assert.strictEqual(ostatni.totalTokens, 1000, 'suma policzona, gdy nie przyszla')
    })

    it('padniety zapis zuzycia NIE przewraca odpowiedzi', async () => {
      await zaloguj()
      await chatPOST(zadanie(rozmowa(portalA.slug)))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Ksztalt, ktorego kolumny nie przyjma.
      await assert.doesNotReject(() => ai.onEnd!({ usage: { inputTokens: 'duzo' } }))

      errorSpy.mockRestore()
    })
  })

  /**
   * ZAPIS ROZMOWY. Powstal 30.08, po zgloszeniu, ktore zniknelo: rozmowa byla
   * (widac ja w ai_usage), zadania w ClickUpie nie bylo, a ustalic dlaczego
   * nie sposob, bo z rozmowy nie zostawalo NIC poza liczba tokenow.
   */
  describe('zapis rozmowy do weryfikacji', () => {
    /** Krok modelu z wywolaniem narzedzia i jego wynikiem, jak w SDK. */
    const krokZNarzedziem = (output: unknown) => [
      {
        text: 'Dodaje zadanie.',
        toolCalls: [{ toolCallId: 'c1', toolName: 'createTask', input: { name: 'Poprawic przycisk' } }],
        toolResults: [{ toolCallId: 'c1', toolName: 'createTask', output }],
      },
    ]

    async function ostatniZapis(portalId: string) {
      const wpisy = await db.select().from(aiChatLogs).where(eq(aiChatLogs.portalId, portalId))
      return wpisy[wpisy.length - 1]
    }

    it('rozmowa BEZ wywolania narzedzia tez zostawia slad', async () => {
      await zaloguj()
      await chatPOST(zadanie(rozmowa(portalA.slug)))

      await ai.onEnd!({
        usage: { inputTokens: 10, outputTokens: 5 },
        steps: [{ text: 'Zadanie zostalo dodane.' }],
        finishReason: 'stop',
      })

      const wpis = await ostatniZapis(portalA.id)
      assert.ok(wpis, 'rozmowa zapisana')
      // To jest DOKLADNIE przypadek z 30.08: model twierdzi, ze dodal, a
      // narzedzia nie tknal. Bez tego wiersza nie da sie tego zobaczyc.
      assert.strictEqual(wpis.outcome, 'rozmowa')
      assert.strictEqual(wpis.taskId, null)
      const tury = wpis.transcript as Array<{ role: string; text?: string }>
      assert.ok(tury.some(t => t.role === 'user' && t.text === 'przycisk nie dziala'), 'pytanie klienta w zapisie')
      assert.ok(tury.some(t => t.role === 'assistant' && t.text === 'Zadanie zostalo dodane.'), 'odpowiedz modelu w zapisie')
    })

    it('udane utworzenie zapisuje sie z identyfikatorem zadania', async () => {
      await zaloguj()
      await chatPOST(zadanie(rozmowa(portalA.slug)))

      await ai.onEnd!({
        usage: { inputTokens: 10, outputTokens: 5 },
        steps: krokZNarzedziem({ success: true, taskId: 'ai-1', taskName: 'Zadanie z czatu' }),
      })

      const wpis = await ostatniZapis(portalA.id)
      assert.strictEqual(wpis.outcome, 'zadanie')
      assert.strictEqual(wpis.taskId, 'ai-1')
      assert.strictEqual(wpis.taskName, 'Zadanie z czatu')
    })

    it('odmowa narzedzia zapisuje sie jako blad, z trescia bledu', async () => {
      await zaloguj()
      await chatPOST(zadanie(rozmowa(portalA.slug)))

      await ai.onEnd!({
        usage: { inputTokens: 10, outputTokens: 5 },
        steps: krokZNarzedziem({ error: 'Nie udalo sie utworzyc zadania w ClickUpie: 401' }),
      })

      const wpis = await ostatniZapis(portalA.id)
      assert.strictEqual(wpis.outcome, 'blad')
      const tury = wpis.transcript as Array<{ role: string; tool?: { error?: string } }>
      assert.ok(
        tury.some(t => t.role === 'tool' && t.tool?.error?.includes('401')),
        'tresc bledu jest w zapisie, a nie tylko sam fakt bledu'
      )
    })

    it('padniety ClickUp oddaje modelowi blad, zamiast wywracac narzedzie po cichu', async () => {
      await zaloguj()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      clickup.createTask.mockRejectedValueOnce(new Error('ClickUp error 401: token'))
      const t = await narzedzie(portalA.slug)

      const wynik = await t.execute({ name: 'X', description: 'y' })

      // SDK zjada wyjatek z `execute` i oddaje go modelowi jako wynik, wiec
      // bez wlasnego catch awaria ClickUpa nie zostawiala sladu NIGDZIE.
      assert.match(String((wynik as { error?: string }).error), /401/)
      assert.ok(errorSpy.mock.calls.length > 0, 'awaria trafia do logow kontenera')
      errorSpy.mockRestore()
    })
  })
})
