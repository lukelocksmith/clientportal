/**
 * Sprawdzenie kontaktu opiekuna projektu.
 *   npx tsx scripts/check-portalContact.ts
 */
import assert from 'node:assert'
import {
  resolveContact,
  isPlausibleEmail,
  normalizePhone,
  phoneHref,
} from '../src/lib/portalContact'

function testEmail() {
  assert.ok(isPlausibleEmail('paulina.a@important.is'))
  assert.ok(isPlausibleEmail(' hi@important.is '))
  for (const bad of [null, undefined, '', '   ', 'bezmalpy', 'a@b', 'a@b.', '@b.pl', 'a b@c.pl', 'a@@b.pl']) {
    assert.strictEqual(isPlausibleEmail(bad as string), false, `powinno odpaść: ${String(bad)}`)
  }
}

function testPhone() {
  assert.strictEqual(normalizePhone('+48 600 123 456'), '+48 600 123 456')
  assert.strictEqual(normalizePhone('600123456'), '600123456')
  assert.strictEqual(normalizePhone('(22) 123-45-67'), null, 'nawias na początku odpada')
  assert.strictEqual(normalizePhone('+48 (22) 123-45-67'), '+48 (22) 123-45-67')

  // Za krótkie, puste i wszystko, co mogłoby wjechać do href.
  for (const bad of [null, undefined, '', '   ', '12345', 'zadzwoń', '+48 abc', "600123456'\"", 'javascript:alert(1)']) {
    assert.strictEqual(normalizePhone(bad as string), null, `powinno odpaść: ${String(bad)}`)
  }

  assert.strictEqual(phoneHref('+48 600 123 456'), 'tel:+48600123456')
  assert.strictEqual(phoneHref('(22) 123-45-67'), 'tel:221234567')
}

function testResolve() {
  // Nic nie ustawione: portal musi mieć sensowny kontakt bez konfiguracji.
  const bare = resolveContact({})
  assert.strictEqual(bare.email, 'hi@important.is')
  assert.strictEqual(bare.name, 'Zespół important.is')
  assert.strictEqual(bare.phone, null)
  assert.strictEqual(bare.fromPortal, false)

  // Zmienne agencji nadpisują wartości domyślne.
  const fromEnv = resolveContact({}, { name: 'Filip G.', email: 'filip.g@important.is', phone: '+48 600 111 222' })
  assert.strictEqual(fromEnv.name, 'Filip G.')
  assert.strictEqual(fromEnv.email, 'filip.g@important.is')
  assert.strictEqual(fromEnv.phone, '+48 600 111 222')
  assert.strictEqual(fromEnv.fromPortal, false, 'env to nie ustawienie projektu')

  // Pola projektu biją zmienne agencji.
  const fromPortal = resolveContact(
    { contactName: 'Paulina A.', contactEmail: 'paulina.a@important.is' },
    { name: 'Filip G.', email: 'filip.g@important.is', phone: '+48 600 111 222' }
  )
  assert.strictEqual(fromPortal.name, 'Paulina A.')
  assert.strictEqual(fromPortal.email, 'paulina.a@important.is')
  assert.strictEqual(fromPortal.phone, '+48 600 111 222', 'niewypełnione pole spada na env')
  assert.strictEqual(fromPortal.fromPortal, true)

  // Śmieci w bazie nie mogą wysadzić strony, tylko spaść na zapas.
  const junk = resolveContact(
    { contactEmail: 'niepoprawny', contactPhone: 'javascript:alert(1)' },
    { email: 'filip.g@important.is' }
  )
  assert.strictEqual(junk.email, 'filip.g@important.is')
  assert.strictEqual(junk.phone, null)

  // Puste ciągi i same spacje traktujemy jak brak.
  const blank = resolveContact({ contactName: '   ', contactEmail: '', contactPhone: '  ' })
  assert.strictEqual(blank.name, 'Zespół important.is')
  assert.strictEqual(blank.fromPortal, false, 'same spacje to nie konfiguracja')
}

function main() {
  testEmail()
  testPhone()
  testResolve()
  console.log('check-portalContact: OK')
}

main()
