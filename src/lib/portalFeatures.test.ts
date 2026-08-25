import { describe, it } from 'vitest'
import assert from 'node:assert'
import { PORTAL_FEATURES, isPortalFeatureKey, type PortalFeatureKey } from '@/lib/portalFeatures'
import { PORTAL_TABS } from '@/lib/portalTabs'

/**
 * Lista funkcji przelaczanych per projekt.
 *
 * Najwazniejszy test tego pliku to ten o KOMPLETNOSCI: kazda flaga `*Enabled`
 * ze schematu bazy musi byc albo zakladka, albo funkcja z tej listy. Inaczej
 * powstaje flaga, ktorej nie da sie przestawic w panelu — a wlasnie to
 * doprowadzilo do pytania „gdzie jest estymacja" (25.08), mimo ze kod byl
 * wdrozony i dzialal.
 *
 *   npx vitest run src/lib/portalFeatures.test.ts
 */

describe('kompletnosc listy', () => {
  it('kazda funkcja ma etykiete i wyjasnienie skutku dla klienta', () => {
    for (const f of PORTAL_FEATURES) {
      assert.ok(f.label.trim().length > 0, `brak etykiety: ${f.key}`)
      assert.ok(f.hint.trim().length > 10, `brak wyjasnienia: ${f.key}`)
    }
  })

  it('klucze sa unikalne', () => {
    const klucze = PORTAL_FEATURES.map(f => f.key)
    assert.strictEqual(new Set(klucze).size, klucze.length)
  })

  it('funkcja NIE jest jednoczesnie zakladka', () => {
    // Ta sama flaga w dwoch listach dalaby dwa ptaszki na to samo, ktore
    // moglyby pokazywac rozny stan.
    const flagiZakladek = new Set<string>(PORTAL_TABS.map(t => t.flag))
    for (const f of PORTAL_FEATURES) {
      assert.strictEqual(flagiZakladek.has(f.key), false, `${f.key} jest tez zakladka`)
    }
  })

  it('KAZDA flaga *Enabled ze schematu jest zakladka albo funkcja', async () => {
    // To jest strażnik na przyszlosc: dopisanie kolumny `czosEnabled` do
    // schematu bez wpisania jej tutaj zapali ten test, zamiast cicho stworzyc
    // ustawienie dostepne tylko curlem.
    const zrodlo = await import('node:fs').then(fs =>
      fs.readFileSync('src/lib/db/schema.ts', 'utf8')
    )
    // Bierzemy tylko blok tabeli `portals`, bo inne tabele maja wlasne flagi
    // (np. `bellVisible`), ktore nie sa ustawieniem projektu.
    const start = zrodlo.indexOf("export const portals = pgTable")
    const koniec = zrodlo.indexOf("export const portalLists")
    const blok = zrodlo.slice(start, koniec)

    const flagi = [...blok.matchAll(/^\s{2}(\w+Enabled):/gm)].map(m => m[1])
    assert.ok(flagi.length >= 5, `nie znalazlem flag w schemacie, znalazlem: ${flagi.length}`)

    const znane = new Set<string>([
      ...PORTAL_TABS.map(t => String(t.flag)),
      ...PORTAL_FEATURES.map(f => String(f.key)),
    ])

    const bezPanelu = flagi.filter(f => !znane.has(f))
    assert.deepStrictEqual(
      bezPanelu,
      [],
      `te flagi nie da sie przestawic w panelu, dopisz je do PORTAL_FEATURES: ${bezPanelu.join(', ')}`
    )
  })
})

describe('isPortalFeatureKey', () => {
  it('przepuszcza znane klucze', () => {
    for (const f of PORTAL_FEATURES) {
      assert.strictEqual(isPortalFeatureKey(f.key), true)
    }
  })

  it('odrzuca cokolwiek innego', () => {
    for (const zle of ['kanbanEnabled', 'isActive', '', null, undefined, 7, {}]) {
      assert.strictEqual(isPortalFeatureKey(zle), false, `nie powinno przejsc: ${JSON.stringify(zle)}`)
    }
  })

  it('zwezenie typu dziala', () => {
    const raw: unknown = 'estimateReportEnabled'
    if (isPortalFeatureKey(raw)) {
      const k: PortalFeatureKey = raw
      assert.strictEqual(k, 'estimateReportEnabled')
    } else {
      assert.fail('powinno przejsc')
    }
  })
})
