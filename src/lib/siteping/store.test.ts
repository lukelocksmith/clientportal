/**
 * SitepingStore: zgloszenie z widgetu → zadanie w ClickUpie.
 *
 * ClickUp jest tu podstawiony (`vi.mock`), bo prawdziwe wywolania tworzylyby
 * zadania w przestrzeni klienta przy kazdym uruchomieniu testow. Podstawione sa
 * WYLACZNIE granice wychodzace — ClickUp, cache i dziennik zdarzen. Moduly
 * czyste (`annotationMarker`, `reporter`) chodza prawdziwe, wiec te testy
 * sprawdzaja tez ich zlozenie ze store'em, a nie sam store w prozni.
 *
 * Pierwszy plik w repo uzywajacy `vi.mock` — wzorzec dla kolejnych.
 *
 *   npm test
 */
import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'

// `vi.hoisted`, bo `vi.mock` jest wynoszony na sam poczatek pliku — zwykle
// `const` byloby wtedy jeszcze niezainicjalizowane i fabryka mocka wywalilaby
// sie na "Cannot access before initialization".
const { clickup, cache, events } = vi.hoisted(() => ({
  clickup: {
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addTaskAttachment: vi.fn(),
    getTask: vi.fn(),
    getAllTasksForFolder: vi.fn(),
    verifyTaskBelongsToFolder: vi.fn(),
  },
  cache: {
    invalidateFolderTasks: vi.fn(),
    getCachedTasksForScope: vi.fn(),
  },
  events: { logEvent: vi.fn() },
}))

vi.mock('@/lib/clickup', () => clickup)
vi.mock('@/lib/clickupCache', () => cache)
vi.mock('@/lib/portalEvents', () => ({
  ...events,
  EVENT_TASK_CREATED: 'task_created',
}))

import { createClickUpSitepingStore } from './store'
import { embedClientIdMarker, embedUrlMarker } from './annotationMarker'

const PORTAL = {
  id: 'portal-uuid',
  slug: 'wdf',
  name: 'WDF',
  clickupFolderId: 'folder-1',
  defaultListId: 'list-1',
  siteOrigin: 'https://wodadlafirmy.pl',
}

/** Payload w ksztalcie, jaki przysyla widget po walidacji adaptera. */
function input(overrides: Record<string, unknown> = {}) {
  return {
    projectName: 'wdf',
    type: 'bug' as const,
    message: 'Przycisk jest za maly',
    status: 'open' as const,
    url: '/oferta',
    urlPattern: null,
    viewport: '1440x900',
    userAgent: 'Mozilla/5.0',
    authorName: 'Anna Kowalska',
    authorEmail: 'anna@klient.pl',
    clientId: 'client-abc',
    annotations: [
      {
        cssSelector: 'body > button',
        xpath: '/html/body/button',
        textSnippet: 'Zamów teraz',
        elementTag: 'BUTTON',
        textPrefix: '',
        textSuffix: '',
        fingerprint: '1:0:0',
        neighborText: '',
        xPct: 0.1,
        yPct: 0.2,
        wPct: 0.3,
        hPct: 0.4,
        scrollX: 0,
        scrollY: 0,
        viewportW: 1440,
        viewportH: 900,
        devicePixelRatio: 2,
      },
    ],
    screenshotDataUrl: null,
    screenshotRegion: null,
    diagnostics: null,
    ...overrides,
  }
}

/** Zadanie ClickUpa tak, jak wraca z API. */
function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    name: 'Przycisk jest za maly',
    description: null,
    status: { status: 'do zrobienia', color: '#e16b16', type: 'custom', orderindex: 1 },
    priority: null,
    assignees: [],
    date_created: '1786050000000',
    date_updated: '1786050001000',
    date_due: null,
    date_start: null,
    list: { id: 'list-1', name: 'Test' },
    folder: { id: 'folder-1', name: 'All Tasks' },
    parent: null,
    time_estimate: null,
    time_spent: null,
    tags: [{ name: 'siteping' }],
    url: 'https://app.clickup.com/t/task-1',
    ...overrides,
  }
}

/** Zadanie z markerami w opisie, czyli takie, jakie tworzy nasz store. */
function sitepingTask(clientId: string, url: string, overrides: Record<string, unknown> = {}) {
  return task({
    description: `tresc\n\n${embedClientIdMarker(clientId)}\n${embedUrlMarker(url)}`,
    ...overrides,
  })
}

/** Zalacznik z danymi zgloszenia + podstawiony `fetch`, ktory go zwraca. */
function withDataAttachment(t: ReturnType<typeof task>, payload: unknown) {
  const url = 'https://attachments.clickup.test/siteping-data.json'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: payload, taskId: t.id }) }))
  )
  return { ...t, attachments: [{ title: 'siteping-data.json', url }] }
}

const store = () => createClickUpSitepingStore(PORTAL)

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  clickup.createTask.mockResolvedValue(task())
  clickup.getTask.mockResolvedValue(task())
  clickup.addTaskAttachment.mockResolvedValue({ id: 'att', url: 'u', title: 't' })
  clickup.updateTask.mockResolvedValue(task())
  clickup.verifyTaskBelongsToFolder.mockResolvedValue(true)
  cache.getCachedTasksForScope.mockResolvedValue([])
  cache.invalidateFolderTasks.mockResolvedValue(undefined)
  events.logEvent.mockResolvedValue('event-id')
})

describe('createFeedback — sciezka podstawowa', () => {
  it('tworzy zadanie na domyslnej liscie, z tagiem i statusem "do zrobienia"', async () => {
    await store().createFeedback(input())

    assert.strictEqual(clickup.createTask.mock.calls.length, 1)
    const [listId, payload] = clickup.createTask.mock.calls[0]
    assert.strictEqual(listId, 'list-1')
    assert.deepStrictEqual(payload.tags, ['siteping'])
    assert.strictEqual(payload.status, 'do zrobienia')
  })

  it('wstawia do opisu selektor, tekst elementu i tresc zgloszenia', async () => {
    await store().createFeedback(input())

    const { description } = clickup.createTask.mock.calls[0][1]
    assert.match(description, /body > button/)
    assert.match(description, /Zamów teraz/)
    assert.match(description, /Przycisk jest za maly/)
  })

  it('podpisuje zadanie kanalem "zgloszenie z widgetu na stronie"', async () => {
    await store().createFeedback(input())

    const { description } = clickup.createTask.mock.calls[0][1]
    assert.match(description, /\*\*Kanał:\*\* zgłoszenie z widgetu na stronie/)
    assert.match(description, /Anna Kowalska/)
  })

  it('dopisuje link z identyfikatorem zadania DRUGIM zapisem', async () => {
    await store().createFeedback(input())

    // Identyfikator powstaje dopiero przy tworzeniu, wiec pierwszy zapis nie
    // moze go zawierac — link wchodzi osobnym updateTask.
    assert.doesNotMatch(clickup.createTask.mock.calls[0][1].description, /siteping=/)
    assert.strictEqual(clickup.updateTask.mock.calls.length, 1)
    assert.match(
      clickup.updateTask.mock.calls[0][1].description,
      /https:\/\/wodadlafirmy\.pl\/oferta\?siteping=task-1/
    )
  })

  it('nie przewraca zgloszenia, gdy dopisanie linku sie nie uda', async () => {
    clickup.updateTask.mockRejectedValue(new Error('ClickUp padl'))

    const record = await store().createFeedback(input())

    // Zadanie juz istnieje i ma komplet danych — brak samego linku jest
    // niedogodnoscia, nie powodem do utraty tresci napisanej przez klienta.
    assert.strictEqual(record.id, 'task-1')
    assert.strictEqual(clickup.addTaskAttachment.mock.calls.length, 1)
  })

  it('pomija dopisywanie linku, gdy origin jest nieznany', async () => {
    const bezOriginu = createClickUpSitepingStore({ ...PORTAL, siteOrigin: null })
    await bezOriginu.createFeedback(input())

    assert.strictEqual(clickup.updateTask.mock.calls.length, 0)
  })

  it('zapisuje dane zgloszenia jako zalacznik siteping-data.json', async () => {
    await store().createFeedback(input())

    const [taskId, , filename] = clickup.addTaskAttachment.mock.calls[0]
    assert.strictEqual(taskId, 'task-1')
    assert.strictEqual(filename, 'siteping-data.json')
  })

  it('dokleja zrzut ekranu osobnym zalacznikiem, gdy jest', async () => {
    await store().createFeedback(
      input({ screenshotDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' })
    )

    const nazwy = clickup.addTaskAttachment.mock.calls.map(c => c[2])
    assert.deepStrictEqual(nazwy, ['siteping-screenshot.jpg', 'siteping-data.json'])
  })

  it('uniewaznia cache folderu, zeby klient zobaczyl zgloszenie na tablicy', async () => {
    await store().createFeedback(input())

    assert.deepStrictEqual(cache.invalidateFolderTasks.mock.calls[0], ['folder-1'])
  })
})

describe('createFeedback — tozsamosc zglaszajacego', () => {
  it('NIE zapisuje samopodpisu jako tozsamosci w dzienniku zdarzen', async () => {
    await store().createFeedback(input())

    // `audit_log.user_email` czytaja inne miejsca portalu tak, jakby wskazywal
    // realnego czlonka. Widget przyjmuje dowolny adres od kogokolwiek, wiec
    // te kolumny musza zostac puste.
    const [{ actor, meta }] = events.logEvent.mock.calls[0]
    assert.strictEqual(actor.userId, null)
    assert.strictEqual(actor.email, null)
    assert.strictEqual(actor.name, null)
    assert.strictEqual(meta.submittedEmail, 'anna@klient.pl')
    assert.strictEqual(meta.submittedName, 'Anna Kowalska')
  })

  it('odrzuca zgloszenie podszywajace sie pod konto agencji', async () => {
    await assert.rejects(() => store().createFeedback(input({ authorEmail: 'admin@important.is' })))
  })

  it('odrzuca podszycie takze przy innej wielkosci liter i spacjach', async () => {
    await assert.rejects(() =>
      store().createFeedback(input({ authorEmail: '  Admin@Important.IS  ' }))
    )
  })

  it('przy podszyciu NIE tworzy zadnego zadania w ClickUpie', async () => {
    await store()
      .createFeedback(input({ authorEmail: 'admin@important.is' }))
      .catch(() => {})

    // Sedno tego testu: nie chodzi o sam wyjatek, tylko o to, ze odrzucenie
    // nastepuje ZANIM cokolwiek powstanie po stronie ClickUpa.
    assert.strictEqual(clickup.createTask.mock.calls.length, 0)
    assert.strictEqual(clickup.addTaskAttachment.mock.calls.length, 0)
  })
})

describe('createFeedback — powtorne wyslanie tego samego zgloszenia', () => {
  it('zwraca istniejace zadanie zamiast tworzyc drugie', async () => {
    const istniejace = sitepingTask('client-abc', '/oferta')
    cache.getCachedTasksForScope.mockResolvedValue([istniejace])
    clickup.getTask.mockResolvedValue(withDataAttachment(istniejace, input()))

    const record = await store().createFeedback(input())

    assert.strictEqual(record.id, 'task-1')
    assert.strictEqual(clickup.createTask.mock.calls.length, 0)
  })

  it('dokancza przerwane zgloszenie na TYM SAMYM zadaniu, nie tworzy duplikatu', async () => {
    // Zadanie z markerem istnieje, ale zalacznik nigdy sie nie wgral —
    // poprzednia proba umarla w polowie. Ponowienie ma to naprawic.
    const niedokonczone = sitepingTask('client-abc', '/oferta', { attachments: [] })
    cache.getCachedTasksForScope.mockResolvedValue([niedokonczone])
    clickup.getTask.mockResolvedValue(niedokonczone)

    const record = await store().createFeedback(input())

    assert.strictEqual(clickup.createTask.mock.calls.length, 0)
    assert.strictEqual(record.id, 'task-1')
    assert.strictEqual(clickup.addTaskAttachment.mock.calls[0][0], 'task-1')
  })

  it('sciezka naprawcza tez uniewaznia cache i zapisuje zdarzenie', async () => {
    const niedokonczone = sitepingTask('client-abc', '/oferta', { attachments: [] })
    cache.getCachedTasksForScope.mockResolvedValue([niedokonczone])
    clickup.getTask.mockResolvedValue(niedokonczone)

    await store().createFeedback(input())

    assert.strictEqual(cache.invalidateFolderTasks.mock.calls.length, 1)
    assert.strictEqual(events.logEvent.mock.calls[0][0].resourceId, 'task-1')
  })

  it('nie myli zgloszen o roznych clientId', async () => {
    cache.getCachedTasksForScope.mockResolvedValue([sitepingTask('inny-klient', '/oferta')])

    await store().createFeedback(input())

    assert.strictEqual(clickup.createTask.mock.calls.length, 1)
  })
})

describe('createFeedback — brakujacy tag w przestrzeni ClickUp', () => {
  it('ostrzega, gdy ClickUp po cichu zjadl tag siteping', async () => {
    clickup.createTask.mockResolvedValue(task({ tags: [] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await store().createFeedback(input())

    const tresc = warn.mock.calls.map(c => String(c[0])).join(' ')
    // Ostrzezenie musi powiedziec, KTORY portal i JAKI tag — inaczej nie da
    // sie go naprawic bez sledztwa.
    assert.match(tresc, /wdf/)
    assert.match(tresc, /siteping/)
    warn.mockRestore()
  })

  it('milczy, gdy tag jest na miejscu', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await store().createFeedback(input())

    assert.strictEqual(warn.mock.calls.length, 0)
    warn.mockRestore()
  })
})

describe('getFeedbacks — co trafia do panelu widgetu', () => {
  it('pomija zadania bez taga siteping i bez markera', async () => {
    cache.getCachedTasksForScope.mockResolvedValue([
      sitepingTask('a', '/oferta'),
      task({ id: 'obce', description: 'zwykle zadanie zespolu', tags: [] }),
      task({ id: 'bez-markera', description: 'ma tag, ale nie z widgetu' }),
    ])
    clickup.getTask.mockResolvedValue(
      withDataAttachment(sitepingTask('a', '/oferta'), input())
    )

    const page = await store().getFeedbacks({ projectName: 'wdf' })

    assert.strictEqual(page.total, 1)
    assert.strictEqual(page.feedbacks.length, 1)
  })

  it('filtruje po adresie strony, gdy panel o to prosi', async () => {
    cache.getCachedTasksForScope.mockResolvedValue([
      sitepingTask('a', '/oferta'),
      sitepingTask('b', '/kontakt', { id: 'task-2' }),
    ])
    clickup.getTask.mockResolvedValue(
      withDataAttachment(sitepingTask('a', '/oferta'), input())
    )

    const page = await store().getFeedbacks({ projectName: 'wdf', url: '/oferta' })

    assert.strictEqual(page.total, 1)
  })

  it('nie dociaga wiecej niz 20 zadan naraz, choc klient prosi o 100', async () => {
    const duzo = Array.from({ length: 40 }, (_, i) =>
      sitepingTask(`c${i}`, '/oferta', { id: `task-${i}` })
    )
    cache.getCachedTasksForScope.mockResolvedValue(duzo)
    clickup.getTask.mockResolvedValue(
      withDataAttachment(sitepingTask('c0', '/oferta'), input())
    )

    const page = await store().getFeedbacks({ projectName: 'wdf', limit: 100 })

    // Kazde zadanie w wycinku to osobny getTask PLUS pobranie zalacznika,
    // wiec limit od klienta nie moze sterowac liczba wywolan sieciowych.
    assert.strictEqual(clickup.getTask.mock.calls.length, 20)
    // `total` zostaje pelne, zeby panel wiedzial, ile zgloszen jest naprawde.
    assert.strictEqual(page.total, 40)
  })

  it('czyta liste przez cache, nie prosto z ClickUpa', async () => {
    await store().getFeedbacks({ projectName: 'wdf' })

    // Widget odpytuje przy kazdym wejsciu na strone klienta i przy nawigacji
    // SPA, a jedno przejscie po folderze to kilkanascie wywolan wspolnego
    // tokena — omijanie cache'u wyczerpaloby limit calej reszcie klientow.
    assert.strictEqual(cache.getCachedTasksForScope.mock.calls.length, 1)
    assert.strictEqual(clickup.getAllTasksForFolder.mock.calls.length, 0)
  })

  it('pomija zgloszenia, ktorych nie da sie odtworzyc, zamiast wywalac odczyt', async () => {
    cache.getCachedTasksForScope.mockResolvedValue([sitepingTask('a', '/oferta')])
    clickup.getTask.mockResolvedValue(sitepingTask('a', '/oferta', { attachments: [] }))

    const page = await store().getFeedbacks({ projectName: 'wdf' })

    assert.deepStrictEqual(page.feedbacks, [])
  })

  it('nie wywala sie, gdy pobranie zalacznika padnie na sieci', async () => {
    cache.getCachedTasksForScope.mockResolvedValue([sitepingTask('a', '/oferta')])
    const t = sitepingTask('a', '/oferta')
    clickup.getTask.mockResolvedValue({
      ...t,
      attachments: [{ title: 'siteping-data.json', url: 'https://padnie.test/x.json' }],
    })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))

    const page = await store().getFeedbacks({ projectName: 'wdf' })

    assert.deepStrictEqual(page.feedbacks, [])
  })
})

describe('findByClientId', () => {
  it('zwraca null, gdy nic nie pasuje', async () => {
    assert.strictEqual(await store().findByClientId('nieznane'), null)
  })

  it('odnajduje zgloszenie po markerze w opisie', async () => {
    const t = sitepingTask('client-abc', '/oferta')
    cache.getCachedTasksForScope.mockResolvedValue([t])
    clickup.getTask.mockResolvedValue(withDataAttachment(t, input()))

    const record = await store().findByClientId('client-abc')

    assert.strictEqual(record?.id, 'task-1')
  })
})

describe('updateFeedback — mapowanie statusow na ClickUp', () => {
  const przypadki = [
    ['open', 'do zrobienia'],
    ['in_progress', 'w trakcie'],
    ['resolved', 'zamknięte'],
    ['wont_fix', 'zamknięte'],
  ] as const

  for (const [status, oczekiwany] of przypadki) {
    it(`"${status}" → "${oczekiwany}"`, async () => {
      const t = sitepingTask('a', '/oferta')
      clickup.getTask.mockResolvedValue(withDataAttachment(t, input()))

      await store().updateFeedback('task-1', {
        status,
        resolvedAt: status === 'resolved' || status === 'wont_fix' ? new Date() : null,
      } as never)

      assert.strictEqual(clickup.updateTask.mock.calls[0][1].status, oczekiwany)
    })
  }

  it('odmawia zmiany zadania spoza folderu portalu', async () => {
    clickup.verifyTaskBelongsToFolder.mockResolvedValue(false)

    await assert.rejects(() =>
      store().updateFeedback('cudze-zadanie', { status: 'open', resolvedAt: null } as never)
    )
    assert.strictEqual(clickup.updateTask.mock.calls.length, 0)
  })
})

describe('deleteFeedback i deleteAllFeedbacks', () => {
  it('kasuje zadanie nalezace do portalu', async () => {
    await store().deleteFeedback('task-1')

    assert.deepStrictEqual(clickup.deleteTask.mock.calls[0], ['task-1'])
  })

  it('odmawia kasowania zadania spoza folderu portalu', async () => {
    clickup.verifyTaskBelongsToFolder.mockResolvedValue(false)

    await assert.rejects(() => store().deleteFeedback('cudze-zadanie'))
    assert.strictEqual(clickup.deleteTask.mock.calls.length, 0)
  })

  it('kasowanie hurtem obejmuje TYLKO zadania z widgetu', async () => {
    clickup.getAllTasksForFolder.mockResolvedValue([
      sitepingTask('a', '/oferta'),
      task({ id: 'zespolowe', tags: [] }),
    ])

    await store().deleteAllFeedbacks('wdf')

    assert.strictEqual(clickup.deleteTask.mock.calls.length, 1)
    assert.strictEqual(clickup.deleteTask.mock.calls[0][0], 'task-1')
  })

  it('kasowanie hurtem omija cache, zeby nie dzialac na liscie sprzed 45 sekund', async () => {
    clickup.getAllTasksForFolder.mockResolvedValue([])

    await store().deleteAllFeedbacks('wdf')

    assert.strictEqual(clickup.getAllTasksForFolder.mock.calls.length, 1)
    assert.strictEqual(cache.getCachedTasksForScope.mock.calls.length, 0)
  })
})

describe('verifyProjectOwnership', () => {
  it('przepuszcza zadanie z folderu portalu', async () => {
    assert.strictEqual(await store().verifyProjectOwnership!('task-1', 'wdf'), true)
  })

  it('odrzuca zadanie spoza folderu portalu', async () => {
    clickup.verifyTaskBelongsToFolder.mockResolvedValue(false)
    assert.strictEqual(await store().verifyProjectOwnership!('cudze', 'wdf'), false)
  })
})
