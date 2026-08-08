/**
 * Walidacja dlugosci, cooldown-owanie i formatowanie tresci pomyslu klienta.
 *
 * Podstawione (`vi.mock`) sa WYLACZNIE granice wychodzace: baza (`@/lib/db`)
 * i ClickUp (`@/lib/clickup`). `withReporterFooter` (lib/reporter.ts) jest
 * czysty, wiec chodzi naprawde — te testy sprawdzaja tez jego zlozenie
 * z modulem, nie sam modul w prozni. Wzorzec z src/lib/siteping/store.test.ts.
 *
 * Cooldown oparty na SQL (`ideaSubmittedRecently`) i realny zapis do bazy
 * (`recordIdea`/`countIdeas`) sa TESTOWANE OSOBNO integracyjnie, w
 * tests/integration/portalIdeas.test.ts — tu jest tylko czysta logika
 * i uklad wywolan.
 *
 *   npx vitest run src/lib/portalIdeas.test.ts
 */
import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'

// `vi.hoisted`, bo `vi.mock` jest wynoszony na sam poczatek pliku — zwykly
// `const` bylby wtedy jeszcze niezainicjalizowany.
const { db, clickup } = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
  },
  clickup: {
    createTask: vi.fn(),
    addTaskAttachment: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/clickup', () => clickup)

import {
  submitIdea,
  IDEA_MIN_LENGTH,
  IDEA_MAX_LENGTH,
  IDEA_ACTION,
} from './portalIdeas'

/** Wejscie w ksztalcie, jaki przekazuje route (po walidacji zod). */
function input(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    portalId: 'portal-uuid',
    portalName: 'WDF',
    portalSlug: 'wdf',
    authorEmail: 'anna@klient.pl',
    authorName: 'Anna Kowalska',
    text: 'a'.repeat(IDEA_MIN_LENGTH),
    ...overrides,
  }
}

// Uchwyty do fluent-chainow drizzle, przypisywane na nowo w kazdym tescie —
// zeby dalo sie sprawdzic, co konkretnie zostalo do nich przekazane.
const insertValues = vi.fn()
const insertReturning = vi.fn()
const updateSet = vi.fn()
const updateWhere = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CLICKUP_PORTAL_IDEAS_LIST_ID

  insertReturning.mockResolvedValue([{ id: 'audit-1' }])
  insertValues.mockReturnValue({ returning: insertReturning })
  db.insert.mockReturnValue({ values: insertValues })

  updateWhere.mockResolvedValue(undefined)
  updateSet.mockReturnValue({ where: updateWhere })
  db.update.mockReturnValue({ set: updateSet })

  clickup.createTask.mockResolvedValue({ id: 'task-1' })
  clickup.addTaskAttachment.mockResolvedValue({ id: 'att-1', url: 'https://cu.test/att-1', title: 'x' })
})

/** Plik z dzialajacym arrayBuffer() — jsdom/node maja natywny File, ale bez tresci go nie potrzeba. */
function plik(nazwa = 'zrzut.png'): File {
  return new File(['dane'], nazwa, { type: 'image/png' })
}

describe('submitIdea — granice dlugosci', () => {
  it('odrzuca tekst o jeden znak krotszy niz minimum', async () => {
    const result = await submitIdea(input({ text: 'a'.repeat(IDEA_MIN_LENGTH - 1) }))

    assert.deepStrictEqual(result, { ok: false, reason: 'too-short' })
    assert.strictEqual(db.insert.mock.calls.length, 0, 'zbyt krotki tekst nie ma prawa trafic do bazy')
  })

  it('przepuszcza tekst o dokladnie minimalnej dlugosci', async () => {
    const result = await submitIdea(input({ text: 'a'.repeat(IDEA_MIN_LENGTH) }))

    // Bez CLICKUP_PORTAL_IDEAS_LIST_ID sciezka konczy sie na 'not-configured',
    // ale to dowod, ze walidacja dlugosci PRZEPUSCILA tekst dalej, do zapisu.
    assert.deepStrictEqual(result, { ok: false, reason: 'not-configured' })
    assert.strictEqual(db.insert.mock.calls.length, 1)
  })

  it('przepuszcza tekst o dokladnie maksymalnej dlugosci', async () => {
    const result = await submitIdea(input({ text: 'a'.repeat(IDEA_MAX_LENGTH) }))

    assert.deepStrictEqual(result, { ok: false, reason: 'not-configured' })
    assert.strictEqual(db.insert.mock.calls.length, 1)
  })

  it('odrzuca tekst o jeden znak dluzszy niz maksimum', async () => {
    const result = await submitIdea(input({ text: 'a'.repeat(IDEA_MAX_LENGTH + 1) }))

    assert.deepStrictEqual(result, { ok: false, reason: 'too-long' })
    assert.strictEqual(db.insert.mock.calls.length, 0)
  })

  it('odrzuca pusty tekst', async () => {
    const result = await submitIdea(input({ text: '' }))

    assert.deepStrictEqual(result, { ok: false, reason: 'too-short' })
  })

  it('odrzuca tekst z samych spacji', async () => {
    const result = await submitIdea(input({ text: '   \n\t  ' }))

    assert.deepStrictEqual(result, { ok: false, reason: 'too-short' })
  })

  it('liczy dlugosc PO przycieciu, nie przed', async () => {
    // Bez spacji tekst ma IDEA_MIN_LENGTH - 2 znaki, czyli za malo. Doklejone
    // z zewnatrz spacje nie moga tego zamaskowac.
    const surowy = `   ${'a'.repeat(IDEA_MIN_LENGTH - 2)}   `
    const result = await submitIdea(input({ text: surowy }))

    assert.deepStrictEqual(result, { ok: false, reason: 'too-short' })
  })

  it('przycina otaczajace spacje przed zapisem', async () => {
    const tresc = 'a'.repeat(IDEA_MIN_LENGTH + 5)
    await submitIdea(input({ text: `  ${tresc}  ` }))

    const zapisane = JSON.parse(insertValues.mock.calls[0][0].meta)
    assert.strictEqual(zapisane.text, tresc, 'w bazie nie moze zostac surowy tekst ze spacjami')
  })
})

describe('submitIdea — zapis pomyslu (recordIdea)', () => {
  it('zapisuje autora w KOLUMNACH, nie tylko w meta', async () => {
    await submitIdea(input({ authorEmail: 'bartek@klient.pl', authorName: 'Bartek' }))

    const values = insertValues.mock.calls[0][0]
    assert.strictEqual(values.userEmail, 'bartek@klient.pl')
    assert.strictEqual(values.userName, 'Bartek')
    assert.strictEqual(values.action, IDEA_ACTION)
    assert.strictEqual(values.userId, 'user-1')
    assert.strictEqual(values.portalId, 'portal-uuid')
  })

  it('userId null (admin) zostaje null w zapisie, nie ginie ani nie wywala', async () => {
    await submitIdea(input({ userId: null }))

    assert.strictEqual(insertValues.mock.calls[0][0].userId, null)
  })

  it('resourceId jest null przy pierwszym zapisie, zanim istnieje zadanie', async () => {
    await submitIdea(input())

    assert.strictEqual(insertValues.mock.calls[0][0].resourceId, null)
  })
})

describe('submitIdea — brak konfiguracji listy ClickUp', () => {
  it('nie woła ClickUpa i zwraca not-configured, choc pomysl jest zapisany', async () => {
    const result = await submitIdea(input())

    assert.deepStrictEqual(result, { ok: false, reason: 'not-configured' })
    assert.strictEqual(clickup.createTask.mock.calls.length, 0)
    assert.strictEqual(db.insert.mock.calls.length, 1)
  })
})

describe('submitIdea — sciezka z ClickUpem', () => {
  beforeEach(() => {
    process.env.CLICKUP_PORTAL_IDEAS_LIST_ID = 'list-99'
  })

  it('tworzy zadanie na skonfigurowanej liscie ze statusem backlog', async () => {
    const result = await submitIdea(input())

    assert.deepStrictEqual(result, { ok: true, taskCreated: true, attachmentsFailed: 0 })
    assert.strictEqual(clickup.createTask.mock.calls.length, 1)
    const [listId, payload] = clickup.createTask.mock.calls[0]
    assert.strictEqual(listId, 'list-99')
    assert.strictEqual(payload.status, 'backlog')
  })

  it('nazwa zadania ma prefiks projektu i pierwsza linie pomyslu', async () => {
    await submitIdea(input({ portalSlug: 'onyx', text: `Dodajcie ciemny motyw\n${'a'.repeat(IDEA_MIN_LENGTH)}` }))

    const { name } = clickup.createTask.mock.calls[0][1]
    assert.strictEqual(name, '[portal onyx] Dodajcie ciemny motyw')
  })

  it('przycina pierwsza linie nazwy do 80 znakow', async () => {
    const dlugaPierwszaLinia = 'x'.repeat(120)
    await submitIdea(input({ text: `${dlugaPierwszaLinia}\n${'a'.repeat(IDEA_MIN_LENGTH)}` }))

    const { name } = clickup.createTask.mock.calls[0][1]
    // "[portal wdf] " ma 13 znakow, potem dokladnie 80 znakow tresci.
    assert.strictEqual(name.length, '[portal wdf] '.length + 80)
    assert.ok(name.endsWith('x'.repeat(80)))
  })

  it('opis zadania niesie tresc pomyslu i stopke zglaszajacego', async () => {
    await submitIdea(input({ text: 'Prosba o eksport do PDF, dziekuje za uwage' }))

    const { description } = clickup.createTask.mock.calls[0][1]
    assert.match(description, /Prosba o eksport do PDF/)
    assert.match(description, /\*\*Zgłoszone przez:\*\* Anna Kowalska <anna@klient.pl>/)
    assert.match(description, /\*\*Kanał:\*\* Dashboard, pomysł na ulepszenie portalu/)
  })

  it('dopisuje id zadania do zapisanego pomyslu (drugi zapis, po utworzeniu)', async () => {
    await submitIdea(input())

    assert.strictEqual(db.update.mock.calls.length, 1)
    assert.strictEqual(updateSet.mock.calls[0][0].resourceId, 'task-1')
  })

  it('gdy ClickUp padnie, pomysl i tak liczy sie jako dostarczony klientowi', async () => {
    clickup.createTask.mockRejectedValue(new Error('ClickUp niedostepny'))

    const result = await submitIdea(input())

    // Kolejnosc jest celowa (patrz komentarz w portalIdeas.ts): zapis u nas juz
    // sie odbyl, wiec awaria ClickUpa nie moze zamienic sukcesu klienta w blad.
    assert.deepStrictEqual(result, { ok: true, taskCreated: false, attachmentsFailed: 0 })
    assert.strictEqual(db.insert.mock.calls.length, 1, 'pomysl musi byc zapisany mimo awarii ClickUpa')
    assert.strictEqual(db.update.mock.calls.length, 0, 'bez zadania nie ma czego linkowac')
  })

  it('gdy ClickUp padnie a pomysl mial zrzuty, liczy je jako nieudane (nie ma gdzie ich podpiac)', async () => {
    clickup.createTask.mockRejectedValue(new Error('ClickUp niedostepny'))

    const result = await submitIdea(input({ files: [plik(), plik()] }))

    assert.deepStrictEqual(result, { ok: true, taskCreated: false, attachmentsFailed: 2 })
    assert.strictEqual(clickup.addTaskAttachment.mock.calls.length, 0, 'bez zadania nie ma czego zalaczac')
  })
})

describe('submitIdea — zalaczniki', () => {
  beforeEach(() => {
    process.env.CLICKUP_PORTAL_IDEAS_LIST_ID = 'list-99'
  })

  it('bez plikow nie wola addTaskAttachment ani razu', async () => {
    const result = await submitIdea(input())

    assert.deepStrictEqual(result, { ok: true, taskCreated: true, attachmentsFailed: 0 })
    assert.strictEqual(clickup.addTaskAttachment.mock.calls.length, 0)
  })

  it('kazdy plik idzie na UTWORZONE zadanie, w tej samej kolejnosci', async () => {
    const a = plik('a.png')
    const b = plik('b.png')
    await submitIdea(input({ files: [a, b] }))

    assert.strictEqual(clickup.addTaskAttachment.mock.calls.length, 2)
    assert.strictEqual(clickup.addTaskAttachment.mock.calls[0][0], 'task-1')
    assert.strictEqual(clickup.addTaskAttachment.mock.calls[0][2], 'a.png')
    assert.strictEqual(clickup.addTaskAttachment.mock.calls[1][2], 'b.png')
  })

  it('jeden nieudany upload NIE psuje calego zgloszenia, tylko liczy sie do attachmentsFailed', async () => {
    clickup.addTaskAttachment
      .mockResolvedValueOnce({ id: 'att-1', url: 'https://cu.test/1', title: 'a' })
      .mockRejectedValueOnce(new Error('ClickUp 500'))

    const result = await submitIdea(input({ files: [plik('a.png'), plik('b.png')] }))

    assert.deepStrictEqual(result, { ok: true, taskCreated: true, attachmentsFailed: 1 })
  })
})
