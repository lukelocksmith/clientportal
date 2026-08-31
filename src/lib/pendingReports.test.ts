import { describe, it, expect } from 'vitest'
import { nextAttemptDelayMs, shouldAlert, ALERT_AFTER_MINUTES } from './pendingReports'

const minuty = (n: number) => n * 60_000

describe('odstępy między próbami dowiezienia', () => {
  it('pierwsza próba po minucie, nie natychmiast w pętli', () => {
    expect(nextAttemptDelayMs(1)).toBe(minuty(1))
  })

  it('odstęp rośnie, żeby przy dłuższej awarii nie dobijać ClickUpa', () => {
    expect(nextAttemptDelayMs(2)).toBe(minuty(5))
    expect(nextAttemptDelayMs(3)).toBe(minuty(15))
    expect(nextAttemptDelayMs(4)).toBe(minuty(60))
  })

  it('po wyczerpaniu listy odstęp zostaje na ostatnim, nie wraca do minuty', () => {
    expect(nextAttemptDelayMs(5)).toBe(minuty(180))
    expect(nextAttemptDelayMs(99)).toBe(minuty(180))
  })

  it('zero i wartości ujemne traktujemy jak pierwszą próbę', () => {
    expect(nextAttemptDelayMs(0)).toBe(minuty(1))
    expect(nextAttemptDelayMs(-3)).toBe(minuty(1))
  })
})

describe('kiedy zgłoszenie w kolejce woła człowieka', () => {
  const teraz = new Date('2026-08-31T10:00:00Z')

  it('świeża porażka to jeszcze nie alarm — ClickUp mruga na sekundy', () => {
    expect(shouldAlert({ createdAt: new Date('2026-08-31T09:58:00Z'), attempts: 1 }, teraz)).toBe(false)
  })

  it('kwadrans czekania i druga nieudana próba to alarm', () => {
    expect(
      shouldAlert({ createdAt: new Date(teraz.getTime() - minuty(ALERT_AFTER_MINUTES)), attempts: 2 }, teraz)
    ).toBe(true)
  })

  it('długie czekanie po JEDNEJ próbie jeszcze nie alarmuje', () => {
    // Jedna próba może być z chwili zgłoszenia; alarm ma znaczyć „ponawiamy
    // i nadal nie idzie", a nie „leży w kolejce, bo cron jeszcze nie wpadł".
    expect(shouldAlert({ createdAt: new Date(teraz.getTime() - minuty(60)), attempts: 1 }, teraz)).toBe(false)
  })
})
