/**
 * Sprawdzenie logiki zakładek. Repo nie ma runnera testów, więc trzymamy się
 * wzorca z check-timeReports.ts: node:assert + npx tsx.
 *
 *   npx tsx scripts/check-portalTabs.ts
 */
import assert from 'node:assert'
import {
  PORTAL_TABS,
  visibleTabs,
  isTabEnabled,
  firstEnabledTabPath,
  type PortalFlags,
} from '../src/lib/portalTabs'

const ALL_OFF: PortalFlags = {
  kanbanEnabled: false,
  reportsEnabled: false,
  historyEnabled: false,
  dashboardEnabled: false,
}
const ALL_ON: PortalFlags = {
  kanbanEnabled: true,
  reportsEnabled: true,
  historyEnabled: true,
  dashboardEnabled: true,
}

function main() {
  // Domyślny stan portalu: sam kanban.
  const onlyKanban = { ...ALL_OFF, kanbanEnabled: true }
  assert.deepStrictEqual(
    visibleTabs(onlyKanban).map(t => t.key),
    ['kanban'],
    'domyślnie widoczny jest tylko kanban'
  )

  // Flaga włączona, ale strona jeszcze nie istnieje => zakładki NIE ma.
  // To jest zabezpieczenie przed pokazaniem klientowi linku do 404.
  const historia = PORTAL_TABS.find(t => t.key === 'historia')!
  if (!historia.implemented) {
    assert.strictEqual(
      isTabEnabled({ ...ALL_OFF, historyEnabled: true }, 'historia'),
      false,
      'niezaimplementowana zakładka nie może się pojawić od samej flagi'
    )
    assert.ok(
      !visibleTabs(ALL_ON).some(t => t.key === 'historia'),
      'Historia nie wchodzi do widocznych, dopóki implemented=false'
    )
  }

  // Wyłączona flaga zamyka zakładkę, nawet gdy strona istnieje.
  assert.strictEqual(isTabEnabled(ALL_OFF, 'raporty'), false)
  assert.strictEqual(isTabEnabled({ ...ALL_OFF, reportsEnabled: true }, 'raporty'), true)

  // Kolejność jest stabilna: kanban przed raportami.
  const order = PORTAL_TABS.map(t => t.key)
  assert.ok(order.indexOf('kanban') < order.indexOf('raporty'), 'kanban przed raportami')

  // Kanban jest korzeniem portalu, nie podstroną.
  assert.strictEqual(PORTAL_TABS.find(t => t.key === 'kanban')!.path, '')

  // Przekierowanie z wyłączonej zakładki.
  assert.strictEqual(firstEnabledTabPath(onlyKanban, 'onyx'), '/onyx')
  assert.strictEqual(
    firstEnabledTabPath({ ...ALL_OFF, reportsEnabled: true }, 'onyx'),
    '/onyx/raporty',
    'przy wyłączonym kanbanie ląduje na pierwszej dostępnej zakładce'
  )

  // Wszystko wyłączone to stan osiągalny w /admin. Musi zwrócić null,
  // inaczej brama w page.tsx wpadłaby w pętlę przekierowań na samą siebie.
  assert.strictEqual(
    firstEnabledTabPath(ALL_OFF, 'onyx'),
    null,
    'brak włączonych zakładek zwraca null, nie ścieżkę'
  )

  // Każda flaga w PORTAL_TABS musi istnieć w PortalFlags (literówka w nazwie
  // flagi dawałaby undefined, czyli zakładkę zawsze ukrytą, bez błędu).
  for (const tab of PORTAL_TABS) {
    assert.ok(tab.flag in ALL_ON, `flaga ${tab.flag} nie istnieje w PortalFlags`)
    assert.strictEqual(typeof ALL_ON[tab.flag], 'boolean', `flaga ${tab.flag} nie jest boolean`)
  }

  // Klucze zakładek są unikalne.
  assert.strictEqual(new Set(order).size, order.length, 'zduplikowany klucz zakładki')

  console.log('check-portalTabs: OK')
}

main()
