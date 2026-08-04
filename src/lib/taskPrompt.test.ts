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
  ALARM_LEVEL,
  CHAT_LEVELS,
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

  it('czat oferuje trzy poziomy, awaria idzie przyciskiem', () => {
    assert.deepStrictEqual(CHAT_LEVELS.map(l => l.code), ['P1', 'P2', 'P3'])
    assert.strictEqual(ALARM_LEVEL.code, 'P0')
    assert.strictEqual(ALARM_LEVEL.clickup, 1)
  })

  it('prompt pokazuje skale czatu i odwzorowanie', () => {
    const p = buildNewTaskPrompt({ portalName: 'Onyx', today: 'poniedziałek, 4 sierpnia 2026' })

    for (const l of CHAT_LEVELS) {
      assert.ok(p.includes(`**${l.code}, ${l.label}**`), `brak poziomu ${l.code} w promptcie`)
      assert.ok(p.includes(`${l.code} = ${l.clickup}`), `brak odwzorowania ${l.code}`)
    }

    // P0 NIE moze byc na liscie do wyboru: alarm ma osobny przycisk, ktory
    // wysyla powiadomienia. Poziom z listy nie wysyla nic.
    assert.ok(
      !p.includes(`**${ALARM_LEVEL.code}, ${ALARM_LEVEL.label}**`),
      'P0 wrocil na liste poziomow do wyboru'
    )
    assert.ok(/przycisk Alarm/.test(p), 'brak odeslania do przycisku Alarm')

    // Nazwa portalu i data wchodza do tekstu, inaczej model nie wie, z kim
    // rozmawia i jak liczyc "pojutrze".
    assert.ok(p.includes('Portal klienta: Onyx'))
    assert.ok(p.includes('poniedziałek, 4 sierpnia 2026'))

    // Poziom musi byc potwierdzony przez klienta, nie ustawiony po cichu.
    assert.ok(/POTWIERDZA KLIENT/.test(p), 'zniknal nakaz potwierdzenia poziomu')
    // Rozbieznosc miedzy wyborem klienta i definicja musi trafic do opisu.
    assert.ok(/definicja wskazuje/.test(p), 'brak zapisu rozbieznosci w opisie')

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
