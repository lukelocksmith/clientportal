/**
 * Sprawdzenie skali priorytetów i promptu zgłaszania zadań.
 *   npm test
 *
 * Tu pilnujemy tego, co da się rozstrzygnąć bez modelu: odwzorowania na pole
 * ClickUpa i tego, czy prompt w ogóle pokazuje wszystkie cztery poziomy.
 * Jak model klasyfikuje zgłoszenia, mierzy scripts/check-priority.ts.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  PRIORITY_LEVELS,
  buildNewTaskPrompt,
  levelByClickupPriority,
  taskInputSchema,
} from '@/lib/taskPrompt'

describe('taskPrompt', () => {
  it('skala odpowiada polu priority w ClickUpie', () => {
    // 1=urgent, 2=high, 3=normal, 4=low. Sprawdzone na 48 zadaniach Onyxu
    // przez API, wiec to nie jest domysl z dokumentacji.
    assert.deepStrictEqual(
      PRIORITY_LEVELS.map(l => [l.code, l.clickup]),
      [['P0', 1], ['P1', 2], ['P2', 3], ['P3', 4]]
    )

    // Odwrotne odwzorowanie musi sie zgadzac, bo opisuje juz zapisane zadania.
    for (const l of PRIORITY_LEVELS) {
      assert.strictEqual(levelByClickupPriority(l.clickup)?.code, l.code)
    }
    assert.strictEqual(levelByClickupPriority(9), undefined, 'nieznana wartosc nie udaje poziomu')
  })

  it('prompt pokazuje cala skale i odwzorowanie', () => {
    const p = buildNewTaskPrompt({ portalName: 'Onyx', today: 'poniedziałek, 4 sierpnia 2026' })

    for (const l of PRIORITY_LEVELS) {
      assert.ok(p.includes(`**${l.code}, ${l.label}**`), `brak poziomu ${l.code} w promptcie`)
      assert.ok(p.includes(`${l.code} = ${l.clickup}`), `brak odwzorowania ${l.code}`)
    }

    // Nazwa portalu i data wchodza do tekstu, inaczej model nie wie, z kim
    // rozmawia i jak liczyc "pojutrze".
    assert.ok(p.includes('Portal klienta: Onyx'))
    assert.ok(p.includes('poniedziałek, 4 sierpnia 2026'))

    // Regula, ktora wprowadzil klient: pytanie o priorytet jest obowiazkowe.
    assert.ok(/PYTASZ ZAWSZE/.test(p), 'zniknal nakaz pytania o priorytet')

    // Czasow reakcji model podawac NIE moze: sa w umowie, nie w promptcie,
    // a pomylka w tej liczbie jest obietnica, ktorej zespol nie dotrzyma.
    assert.ok(!/\b4 h\b|\b1 godzina\b|dni robocze/.test(p), 'prompt obiecuje czasy reakcji')
  })

  it('schema narzedzia przyjmuje tylko poziomy ze skali', () => {
    const ok = {
      name: 'Test',
      description: 'x'.repeat(100),
      priority: 2,
    }
    assert.ok(taskInputSchema.safeParse(ok).success)

    for (const bad of [0, 5, -1]) {
      assert.strictEqual(
        taskInputSchema.safeParse({ ...ok, priority: bad }).success,
        false,
        `priorytet ${bad} nie moze przejsc`
      )
    }

    // Krotki opis odpada: zadanie bez kontekstu jest bezuzyteczne dla zespolu.
    assert.strictEqual(
      taskInputSchema.safeParse({ ...ok, description: 'za krotko' }).success,
      false
    )
  })
})
