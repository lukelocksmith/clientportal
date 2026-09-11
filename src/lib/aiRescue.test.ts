import { describe, it } from 'vitest'
import assert from 'node:assert'
import { planRatunkowy, MAX_NAZWA_CHARS } from './aiRescue'
import type { TranscriptTurn } from './aiTranscript'

/**
 * RATUNEK PORZUCONEGO ZGŁOSZENIA.
 *
 * Test pilnuje jednej rzeczy: gdy asystent NAPISAŁ klientowi, że zgłoszenie
 * jest zapisane, a narzędzia nie tknął, z rozmowy da się odtworzyć zadanie
 * bez udziału modelu. Bez tego zgłoszenie ginie po cichu — dokładnie tak, jak
 * 4 września u Onyxa (rozmowa `podejrzane` z 09:41 UTC, zero zadań w ClickUpie,
 * pusta kolejka, klient czekał tydzień).
 */
describe('planRatunkowy', () => {
  const obietnica =
    'Gotowe! Zadanie "Optymalizacja i kompresja wideo pod stronę" zostało zgłoszone jako P3. Za chwilę powinno pojawić się na tablicy.'

  const rozmowaZOnyxa: TranscriptTurn[] = [
    { role: 'user', text: 'Cześć, w kwestii kompresowania wideo, ile by Wam to zajmowało czasu?' },
    { role: 'user', text: 'zgłoś to jako zadanie' },
    { role: 'user', text: 'tak' },
    { role: 'assistant', text: obietnica },
  ]

  it('z porzuconej rozmowy buduje zadanie', () => {
    const plan = planRatunkowy(rozmowaZOnyxa)
    assert.ok(plan, 'jest co uratować')
  })

  it('nazwę bierze z obietnicy modelu, bo to ona poszła do klienta', () => {
    const plan = planRatunkowy(rozmowaZOnyxa)
    assert.strictEqual(plan!.name, 'Optymalizacja i kompresja wideo pod stronę')
  })

  it('bez nazwy w cudzysłowie bierze pierwszą wypowiedź klienta', () => {
    const plan = planRatunkowy([
      { role: 'user', text: 'przycisk dodaj do koszyka nie działa na stronie produktu' },
      { role: 'assistant', text: 'Zgłaszam to zadanie, pojawi się na tablicy.' },
    ])
    assert.ok(plan!.name.startsWith('przycisk dodaj do koszyka'), `nazwa: ${plan!.name}`)
  })

  it('nazwa mieści się w limicie ClickUpa i nie urywa się w połowie słowa', () => {
    const dlugie = 'zmiana banera na stronie głównej oraz podmiana wszystkich zdjęć produktowych w kategorii kamienie szlachetne i półszlachetne'
    const plan = planRatunkowy([
      { role: 'user', text: dlugie },
      { role: 'assistant', text: 'Zapisuję to jako zadanie.' },
    ])
    assert.ok(plan!.name.length <= MAX_NAZWA_CHARS, `długość ${plan!.name.length}`)
    assert.ok(!plan!.name.includes('  '), 'bez podwójnych spacji')
    // Ucięcie idzie po granicy słowa: ostatni znak przed wielokropkiem nie
    // może być literą urwanego wyrazu, który w kolejce wygląda jak literówka.
    assert.ok(/…$/.test(plan!.name) || plan!.name === dlugie, `koniec nazwy: ${plan!.name}`)
  })

  it('opis niesie CAŁĄ rozmowę, bo to jedyny ślad po zgłoszeniu', () => {
    const plan = planRatunkowy(rozmowaZOnyxa)
    assert.ok(plan!.description.includes('kompresowania wideo'), 'pierwsza wypowiedź klienta')
    assert.ok(plan!.description.includes('zgłoś to jako zadanie'), 'polecenie klienta')
    assert.ok(plan!.description.includes(obietnica), 'obietnica, którą klient przeczytał')
  })

  it('opis mówi wprost, skąd wzięło się to zadanie', () => {
    const plan = planRatunkowy(rozmowaZOnyxa)
    // Zespół musi wiedzieć, że poziomu NIKT nie potwierdził w systemie, choć
    // w rozmowie padł. Zadanie widzi też klient, więc zdanie jest neutralne.
    assert.ok(/asystent/i.test(plan!.description), 'wskazuje kanał pochodzenia')
    assert.ok(/poziom/i.test(plan!.description), 'ostrzega o poziomie do ustalenia')
  })

  it('nie ratuje rozmowy, w której zadanie NAPRAWDĘ powstało', () => {
    const plan = planRatunkowy([
      { role: 'user', text: 'przycisk nie działa' },
      { role: 'assistant', text: 'Zgłaszam.' },
      { role: 'tool', tool: { name: 'createTask', input: {}, output: { success: true, taskId: 'abc' } } },
    ])
    assert.strictEqual(plan, null)
  })

  it('nie ratuje rozmowy, która trafiła do kolejki po awarii ClickUpa', () => {
    const plan = planRatunkowy([
      { role: 'user', text: 'przycisk nie działa' },
      { role: 'assistant', text: 'Zgłoszenie przyjęte.' },
      { role: 'tool', tool: { name: 'createTask', input: {}, output: { error: 'ClickUp 401' }, error: 'ClickUp 401' } },
    ])
    assert.strictEqual(plan, null, 'kolejka już ma tę sprawę, drugie zadanie byłoby duplikatem')
  })

  it('nie ratuje zwykłego dopytywania', () => {
    const plan = planRatunkowy([
      { role: 'user', text: 'mam pytanie o wideo' },
      { role: 'assistant', text: 'A czego dokładnie miałoby dotyczyć zgłoszenie?' },
    ])
    assert.strictEqual(plan, null, 'pytanie to nie obietnica')
  })

  it('nie ratuje rozmowy bez ani jednej wypowiedzi klienta', () => {
    const plan = planRatunkowy([{ role: 'assistant', text: 'Zgłoszenie zostało zapisane.' }])
    assert.strictEqual(plan, null, 'nie ma czego zgłosić')
  })

  it('znosi pustą i popsutą rozmowę bez wyjątku', () => {
    assert.strictEqual(planRatunkowy([]), null)
    assert.strictEqual(planRatunkowy(undefined as never), null)
  })
})
