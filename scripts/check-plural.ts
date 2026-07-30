/**
 * Sprawdzenie polskiej odmiany po liczbie.
 *   npx tsx scripts/check-plural.ts
 */
import assert from 'node:assert'
import { plural, pluralForm, USERS, REQUESTS, SUBTASKS, HOURS_LOCATIVE } from '../src/lib/plural'

function main() {
  // Przypadki, na ktorych wywracal sie poprzedni kod.
  assert.strictEqual(plural(2, USERS), '2 użytkownicy', 'było "2 użytkowniki"')
  assert.strictEqual(plural(22, REQUESTS), '22 zgłoszenia', 'było "22 zgłoszeń"')
  assert.strictEqual(plural(12, REQUESTS), '12 zgłoszeń', '12 to wyjątek, forma many')

  // Pelna tabela dla 0..25, zeby wyjatki 12-14 byly widoczne wprost.
  const expected: Record<number, string> = {
    0: 'zgłoszeń',
    1: 'zgłoszenie',
    2: 'zgłoszenia',
    3: 'zgłoszenia',
    4: 'zgłoszenia',
    5: 'zgłoszeń',
    10: 'zgłoszeń',
    11: 'zgłoszeń',
    12: 'zgłoszeń',
    13: 'zgłoszeń',
    14: 'zgłoszeń',
    15: 'zgłoszeń',
    21: 'zgłoszeń',
    22: 'zgłoszenia',
    23: 'zgłoszenia',
    24: 'zgłoszenia',
    25: 'zgłoszeń',
  }
  for (const [n, form] of Object.entries(expected)) {
    assert.strictEqual(pluralForm(Number(n), REQUESTS), form, `${n} -> ${form}`)
  }

  // 101 i 102: setki nie zmieniaja reguly, liczy sie koncowka.
  assert.strictEqual(pluralForm(101, REQUESTS), 'zgłoszeń')
  assert.strictEqual(pluralForm(102, REQUESTS), 'zgłoszenia')
  assert.strictEqual(pluralForm(112, REQUESTS), 'zgłoszeń', '112 to znowu wyjątek')
  assert.strictEqual(pluralForm(122, REQUESTS), 'zgłoszenia')

  // Zero bierze forme many, nie singular.
  assert.strictEqual(plural(0, USERS), '0 użytkowników')
  assert.strictEqual(plural(0, SUBTASKS), '0 podzadań')

  // Wartosci brzegowe nie moga wysadzic funkcji.
  assert.strictEqual(pluralForm(-2, USERS), 'użytkownicy', 'znak nie ma znaczenia')
  assert.strictEqual(pluralForm(2.7, USERS), 'użytkownicy', 'ucinamy do calkowitej')

  // Godziny w miejscowniku, po przyimku "po".
  assert.strictEqual(plural(1, HOURS_LOCATIVE), '1 godzinie')
  assert.strictEqual(plural(2, HOURS_LOCATIVE), '2 godzinach')
  assert.strictEqual(plural(72, HOURS_LOCATIVE), '72 godzinach')

  // Zadna forma nie moze byc pusta, bo dalaby "2 " w interfejsie.
  for (const forms of [USERS, REQUESTS, SUBTASKS, HOURS_LOCATIVE]) {
    for (const key of ['one', 'few', 'many'] as const) {
      assert.ok(forms[key].length > 0, `pusta forma ${key}`)
    }
  }

  console.log('check-plural: OK')
}

main()
