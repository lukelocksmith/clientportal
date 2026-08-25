import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { parseAssigneeId, assigneeForPortal, assigneesField, agencyFallbackAssignee } from '@/lib/assignee'

/**
 * Kto dostaje zadanie zalozone z portalu.
 *
 * Dwie rzeczy, ktore musza byc pewne:
 *
 *   1. Ustawienie PROJEKTU wygrywa z zapasem agencji — na tym polega caly
 *      wyjatek „WDF i EFF do Filipa, reszta do Pauliny".
 *   2. Brak konfiguracji NIE blokuje zalozenia zadania. Zgloszenie klienta ma
 *      trafic do ClickUpa zawsze; nieprzypisane widac na tablicy, a odrzucone
 *      ginie bez sladu.
 *
 *   npx vitest run src/lib/assignee.test.ts
 */
const PAULINA = 111
const FILIP = 222

beforeEach(() => {
  vi.stubEnv('CLICKUP_DEFAULT_ASSIGNEE_ID', String(PAULINA))
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseAssigneeId', () => {
  it('przyjmuje liczbe i tekst', () => {
    assert.strictEqual(parseAssigneeId(FILIP), FILIP)
    assert.strictEqual(parseAssigneeId('222'), FILIP)
    assert.strictEqual(parseAssigneeId(' 222 '), FILIP)
  })

  it('odrzuca wszystko, co ClickUp odbilby bledem calego zadania', () => {
    // Id spoza workspace albo smiec wywala CALE tworzenie zadania, nie jest
    // cicho pomijane jak zly tag. Wolimy brak przypisania niz brak zgloszenia.
    for (const zle of [null, undefined, '', '  ', 'abc', 0, '0', -5, 1.5, {}, []]) {
      assert.strictEqual(parseAssigneeId(zle), null, `nie powinno przejsc: ${JSON.stringify(zle)}`)
    }
  })
})

describe('assigneeForPortal', () => {
  it('USTAWIENIE PROJEKTU wygrywa z zapasem agencji', () => {
    // To jest sedno: WDF ma Filipa, mimo ze zapasem jest Paulina.
    assert.strictEqual(assigneeForPortal(FILIP), FILIP)
  })

  it('brak ustawienia projektu spada na zapas agencji', () => {
    assert.strictEqual(assigneeForPortal(null), PAULINA)
    assert.strictEqual(assigneeForPortal(undefined), PAULINA)
  })

  it('smieciowe ustawienie projektu tez spada na zapas, nie wywala', () => {
    assert.strictEqual(assigneeForPortal(0), PAULINA)
  })

  it('bez zapasu w env i bez ustawienia zwraca null, nie wyjatek', () => {
    vi.stubEnv('CLICKUP_DEFAULT_ASSIGNEE_ID', '')
    assert.strictEqual(assigneeForPortal(null), null)
    assert.strictEqual(agencyFallbackAssignee(), null)
  })
})

describe('assigneesField', () => {
  it('daje tablice z jedna osoba', () => {
    assert.deepStrictEqual(assigneesField(FILIP), { assignees: [FILIP] })
  })

  it('BEZ nikogo daje pusty obiekt, a NIE assignees: []', () => {
    // Pusta tablica jest dla ClickUpa poleceniem „bez przypisanych" i potrafi
    // zdjac automatyczne przypisanie ustawione po ich stronie. Brak pola
    // zostawia tamta regule w spokoju.
    vi.stubEnv('CLICKUP_DEFAULT_ASSIGNEE_ID', '')
    assert.deepStrictEqual(assigneesField(null), {})
  })

  it('da sie rozwinac w obiekcie zadania', () => {
    const zadanie = { name: 'Zgloszenie', ...assigneesField(FILIP) }
    assert.deepStrictEqual(zadanie, { name: 'Zgloszenie', assignees: [FILIP] })
  })
})
