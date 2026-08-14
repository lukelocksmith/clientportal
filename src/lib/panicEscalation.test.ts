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
  whoTookOver,
  buildHandoverSmsText,
  buildHandoverDiscordText,
  isTaskHandled,
  isEscalationDue,
  minutesSince,
  clickupTaskUrl,
  buildEscalationSmsText,
  buildEscalationDiscordText,
  selectDueAlerts,
  ESCALATION_STEPS_MINUTES,
  ESCALATION_STEPS_DAY,
  ESCALATION_STEPS_NIGHT,
  escalationDueAtIndex,
  isNightInWarsaw,
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

  it('trzecie przypomnienie wypada w 60 minucie, czwarte w 65', () => {
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 2, now: po(60) }), true)
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 3, now: po(64) }), false)
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 3, now: po(65) }), true)
  })

  it('po wyczerpaniu calej drabiny zapada cisza, nawet po dobie', () => {
    assert.strictEqual(isEscalationDue({ createdAt: start, escalationCount: 8, now: po(1440) }), false)
  })

  it('drabina dzienna: 25, 50, 60, 65, 120, 180, 210, 240 minut', () => {
    assert.deepEqual([...ESCALATION_STEPS_DAY], [25, 50, 60, 65, 120, 180, 210, 240])
  })

  it('drabina nocna rzadsza, z minimum pol godziny przerwy: 25, 55, 120, 180, 210, 240', () => {
    assert.deepEqual([...ESCALATION_STEPS_NIGHT], [25, 55, 120, 180, 210, 240])
  })

  it('obie drabiny koncza sie na czwartej godzinie, czyli na umowionym czasie reakcji', () => {
    assert.strictEqual(ESCALATION_STEPS_DAY[ESCALATION_STEPS_DAY.length - 1], 240)
    assert.strictEqual(ESCALATION_STEPS_NIGHT[ESCALATION_STEPS_NIGHT.length - 1], 240)
  })
})

describe('selectDueAlerts', () => {
  const now = new Date('2026-08-13T11:00:00Z')
  const minut = (m: number) => new Date(now.getTime() - m * 60_000)

  it('wybiera tylko te alarmy, ktorym uplynal ich krok', () => {
    const alerts = [
      { id: 'swiezy', createdAt: minut(5), escalationCount: 0 },
      { id: 'pierwsza-eskalacja', createdAt: minut(26), escalationCount: 0 },
      { id: 'czeka-na-druga', createdAt: minut(45), escalationCount: 1 },
      { id: 'druga-eskalacja', createdAt: minut(51), escalationCount: 1 },
      { id: 'wyczerpany', createdAt: minut(300), escalationCount: 8 },
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

describe('whoTookOver — kto przejal sprawe', () => {
  it('pomija osobe dyzurna, bo ona jest przypisana automatycznie', () => {
    assert.strictEqual(
      whoTookOver([{ id: DUTY, username: 'Paulina' }, { id: INNY, username: 'Filip Gorny' }], DUTY),
      'Filip Gorny'
    )
  })

  it('wymienia wszystkich, gdy sprawe wzielo kilka osob', () => {
    assert.strictEqual(
      whoTookOver([{ id: INNY, username: 'Filip' }, { id: 999, username: 'Artem' }], DUTY),
      'Filip, Artem'
    )
  })

  it('bez imienia w ClickUpie mowi "ktos z zespolu", zamiast pustego miejsca', () => {
    assert.strictEqual(whoTookOver([{ id: INNY, username: '' }], DUTY), 'ktoś z zespołu')
    assert.strictEqual(whoTookOver([], DUTY), 'ktoś z zespołu')
    assert.strictEqual(whoTookOver(null, DUTY), 'ktoś z zespołu')
  })
})

describe('buildHandoverSmsText', () => {
  const base = { portalName: 'Onyx', who: 'Filip Gorny', minutes: 12, taskUrl: 'https://app.clickup.com/t/869x' }

  it('mowi KTO wzial sprawe i po ilu minutach', () => {
    const t = buildHandoverSmsText(base)
    assert.match(t, /PRZEJETE/)
    assert.match(t, /Filip Gorny/)
    assert.match(t, /12 min/)
    assert.match(t, /869x/)
  })

  it('miesci sie w jednym segmencie', () => {
    const t = buildHandoverSmsText({ ...base, portalName: 'B'.repeat(60), who: 'I'.repeat(60) })
    assert.ok(t.length <= 160, `dlugosc ${t.length}`)
  })

  it('nie przepuszcza znakow spoza GSM-7', () => {
    const t = buildHandoverSmsText({ ...base, who: 'Paweł Ćwikła', portalName: 'Żółw' })
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(t, /[^\x20-\x7E]/)
  })
})

describe('buildHandoverDiscordText', () => {
  it('niesie osobe, status zadania i link', () => {
    const t = buildHandoverDiscordText({
      portalName: 'Onyx',
      who: 'Filip Gorny',
      message: 'strona nie dziala',
      minutes: 12,
      status: 'w trakcie',
      taskUrl: 'https://app.clickup.com/t/869x',
    })
    assert.match(t, /przejęty/i)
    assert.match(t, /Filip Gorny/)
    assert.match(t, /w trakcie/)
    assert.match(t, /869x/)
  })
})

describe('isNightInWarsaw — pora liczona w strefie polskiej, nie z zegara serwera', () => {
  it('23:30 czasu polskiego to noc, mimo ze serwer w UTC widzi 21:30', () => {
    assert.strictEqual(isNightInWarsaw(new Date('2026-08-14T21:30:00Z')), true)
  })

  it('6:30 rano to jeszcze noc', () => {
    assert.strictEqual(isNightInWarsaw(new Date('2026-08-14T04:30:00Z')), true)
  })

  it('9:00 rano to dzien', () => {
    assert.strictEqual(isNightInWarsaw(new Date('2026-08-14T07:00:00Z')), false)
  })

  it('21:00 czasu polskiego to jeszcze dzien', () => {
    assert.strictEqual(isNightInWarsaw(new Date('2026-08-14T19:00:00Z')), false)
  })

  it('zima granica jest ta sama, mimo innej roznicy do UTC', () => {
    // 22:30 czasu polskiego w styczniu to 21:30 UTC (roznica godzina, nie dwie).
    assert.strictEqual(isNightInWarsaw(new Date('2026-01-15T21:30:00Z')), true)
    assert.strictEqual(isNightInWarsaw(new Date('2026-01-15T20:30:00Z')), false)
  })
})

describe('escalationDueAtIndex', () => {
  const start = new Date('2026-08-14T10:00:00Z').getTime()
  const po = (minuty: number) => start + minuty * 60_000

  it('dzien: czwarte przypomnienie wypada w 65 minucie', () => {
    assert.strictEqual(escalationDueAtIndex(start, 3, po(64), false), false)
    assert.strictEqual(escalationDueAtIndex(start, 3, po(65), false), true)
  })

  it('noc: drugie przypomnienie dopiero w 55 minucie, nie w 50', () => {
    assert.strictEqual(escalationDueAtIndex(start, 1, po(50), true), false)
    assert.strictEqual(escalationDueAtIndex(start, 1, po(55), true), true)
  })

  it('po ostatnim kroku drabiny zapada cisza', () => {
    assert.strictEqual(escalationDueAtIndex(start, 8, po(600), false), false)
    assert.strictEqual(escalationDueAtIndex(start, 6, po(600), true), false)
  })

  it('ujemny indeks nie wysadza funkcji', () => {
    assert.strictEqual(escalationDueAtIndex(start, -1, po(600), false), false)
  })
})
