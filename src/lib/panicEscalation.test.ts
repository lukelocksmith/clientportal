/**
 * Decyzja o eskalacji alarmu: kogo dobudzic po 25 i po 50 minutach.
 *
 * Same funkcje czyste, zero bazy i zero wyjscia na swiat, wiec test odpowiada
 * na pytanie "czy regula jest ta, ktora ustalilismy", a nie "czy atrapa oddala
 * to, co jej kazano".
 *
 *   npx vitest run src/lib/panicEscalation.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'

import {
  isTaskHandled,
  isEscalationDue,
  minutesSince,
  clickupTaskUrl,
  buildEscalationSmsText,
  buildEscalationDiscordText,
  selectDueAlerts,
  ESCALATION_STEPS_MINUTES,
} from './panicEscalation'

/** Paulina w workspace klientow. Osoba przypisywana automatycznie. */
const DUTY = 94729587
/** Filip. Ktokolwiek inny niz osoba dyzurna. */
const INNY = 44435339

describe('isTaskHandled — kiedy sprawa jest przejeta', () => {
  it('sama Paulina i status poczatkowy to NIE jest reakcja', () => {
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: DUTY }], status: 'do zrobienia', dutyAssigneeId: DUTY }),
      false
    )
  })

  it('Paulina plus ktos inny, ale zadanie stoi w "do zrobienia" — wciaz nie', () => {
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: DUTY }, { id: INNY }], status: 'do zrobienia', dutyAssigneeId: DUTY }),
      false
    )
  })

  it('zadanie "w trakcie", ale przypisana tylko Paulina — wciaz nie', () => {
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: DUTY }], status: 'w trakcie', dutyAssigneeId: DUTY }),
      false
    )
  })

  it('ktos inny przypisany OBOK Pauliny i zadanie w trakcie — przejete', () => {
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: DUTY }, { id: INNY }], status: 'w trakcie', dutyAssigneeId: DUTY }),
      true
    )
  })

  it('ktos inny ZAMIAST Pauliny tez sie liczy', () => {
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: INNY }], status: 'w trakcie', dutyAssigneeId: DUTY }),
      true
    )
  })

  it('backlog liczy sie jak "nikt nie ruszyl", tak samo jak "do zrobienia"', () => {
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: INNY }], status: 'backlog', dutyAssigneeId: DUTY }),
      false
    )
  })

  it('wielkosc liter i spacje w statusie nie maja znaczenia', () => {
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: INNY }], status: '  DO ZROBIENIA ', dutyAssigneeId: DUTY }),
      false
    )
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: INNY }], status: 'W Trakcie', dutyAssigneeId: DUTY }),
      true
    )
  })

  it('brak przypisanych to brak reakcji', () => {
    assert.strictEqual(isTaskHandled({ assignees: [], status: 'w trakcie', dutyAssigneeId: DUTY }), false)
    assert.strictEqual(isTaskHandled({ assignees: null, status: 'w trakcie', dutyAssigneeId: DUTY }), false)
  })

  it('brak statusu traktujemy jak brak reakcji, nie jak reakcje', () => {
    // Odpowiedz bez statusu znaczy "nie wiem", a przy alarmie niewiedza ma
    // budzic, nie uciszac.
    assert.strictEqual(isTaskHandled({ assignees: [{ id: INNY }], status: null, dutyAssigneeId: DUTY }), false)
  })

  it('bez ustawionej osoby dyzurnej KAZDY przypisany liczy sie jako ktos inny', () => {
    assert.strictEqual(
      isTaskHandled({ assignees: [{ id: DUTY }], status: 'w trakcie', dutyAssigneeId: null }),
      true
    )
  })
})

describe('isEscalationDue — kiedy wypada kolejne powiadomienie', () => {
  const start = new Date('2026-08-13T10:00:00Z')
  const po = (minuty: number) => new Date(start.getTime() + minuty * 60_000)

  it('pierwsza eskalacja dopiero po 25 minutach', () => {
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 0, now: po(24) }), false)
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 0, now: po(25) }), true)
  })

  it('druga eskalacja dopiero po 50 minutach, liczonych od alarmu', () => {
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 1, now: po(30) }), false)
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 1, now: po(50) }), true)
  })

  it('po dwoch eskalacjach zapada cisza, nawet po godzinach', () => {
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 2, now: po(600) }), false)
  })

  it('sa dokladnie dwa kroki: 25 i 50 minut', () => {
    assert.deepEqual([...ESCALATION_STEPS_MINUTES], [25, 50])
  })
})

describe('selectDueAlerts', () => {
  const now = new Date('2026-08-13T11:00:00Z')
  const minut = (m: number) => new Date(now.getTime() - m * 60_000)

  it('wybiera tylko te alarmy, ktorym uplynal ich krok', () => {
    const alerts = [
      { id: 'swiezy', createdAt: minut(5), escalationCount: 0 },
      { id: 'pierwsza-eskalacja', createdAt: minut(26), escalationCount: 0 },
      { id: 'czeka-na-druga', createdAt: minut(30), escalationCount: 1 },
      { id: 'druga-eskalacja', createdAt: minut(51), escalationCount: 1 },
      { id: 'wyczerpany', createdAt: minut(300), escalationCount: 2 },
    ]

    assert.deepEqual(
      selectDueAlerts(alerts, now).map(a => a.id),
      ['pierwsza-eskalacja', 'druga-eskalacja']
    )
  })
})

describe('minutesSince', () => {
  it('liczy pelne minuty w dol', () => {
    const start = new Date('2026-08-13T10:00:00Z')
    assert.strictEqual(minutesSince(start, new Date('2026-08-13T10:26:59Z')), 26)
  })

  it('nie schodzi ponizej zera przy przestawionym zegarze', () => {
    const start = new Date('2026-08-13T10:00:00Z')
    assert.strictEqual(minutesSince(start, new Date('2026-08-13T09:00:00Z')), 0)
  })
})

describe('clickupTaskUrl', () => {
  it('sklada adres zadania', () => {
    assert.strictEqual(clickupTaskUrl('869eeqyxj'), 'https://app.clickup.com/t/869eeqyxj')
  })

  it('brak zadania to null, a nie link donikad', () => {
    assert.strictEqual(clickupTaskUrl(null), null)
    assert.strictEqual(clickupTaskUrl(''), null)
  })
})

describe('buildEscalationSmsText', () => {
  const base = {
    portalName: 'Onyx',
    message: 'strona nie dziala',
    minutes: 25,
    taskUrl: 'https://app.clickup.com/t/869eeqyxj',
  }

  it('zawiera link do zadania, bo ten jest obowiazkowy', () => {
    assert.match(buildEscalationSmsText(base), /https:\/\/app\.clickup\.com\/t\/869eeqyxj/)
  })

  it('mowi wprost, ze to powtorka i ile czasu minelo', () => {
    const text = buildEscalationSmsText(base)
    assert.match(text, /PONOWNIE/)
    assert.match(text, /25 min/)
    assert.match(text, /Onyx/)
  })

  it('miesci sie w jednym segmencie GSM-7 nawet przy dlugiej tresci', () => {
    const text = buildEscalationSmsText({ ...base, message: 'x'.repeat(400), portalName: 'B'.repeat(60) })
    assert.ok(text.length <= 160, `dlugosc ${text.length}`)
  })

  it('link przezywa ucinanie tresci, bo to on jest wazniejszy', () => {
    const text = buildEscalationSmsText({ ...base, message: 'x'.repeat(400) })
    assert.match(text, /https:\/\/app\.clickup\.com\/t\/869eeqyxj$/)
  })

  it('bez zadania mowi wprost, ze zadanie nie powstalo', () => {
    const text = buildEscalationSmsText({ ...base, taskUrl: null })
    assert.match(text, /NIE powstalo/)
  })

  it('nie przepuszcza znakow spoza GSM-7', () => {
    const text = buildEscalationSmsText({ ...base, portalName: 'Żółw', message: '🚨 strona padła' })
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(text, /[^\x20-\x7E]/)
  })
})

describe('buildEscalationDiscordText', () => {
  it('niesie tresc, osobe i link do zadania', () => {
    const text = buildEscalationDiscordText({
      portalName: 'Onyx',
      message: 'strona nie dziala',
      who: 'Jan Kowalski (jan@onyx.pl)',
      minutes: 25,
      taskUrl: 'https://app.clickup.com/t/869eeqyxj',
    })

    assert.match(text, /ALARM BEZ REAKCJI od 25 minut/)
    assert.match(text, /Onyx/)
    assert.match(text, /strona nie dziala/)
    assert.match(text, /Jan Kowalski/)
    assert.match(text, /869eeqyxj/)
  })

  it('gdy zadania nie ma, mowi to wprost zamiast dawac pusty link', () => {
    const text = buildEscalationDiscordText({
      portalName: 'Onyx',
      message: 'x',
      who: 'ktos',
      minutes: 50,
      taskUrl: null,
    })
    assert.match(text, /nie powstało w ClickUpie/)
  })
})
