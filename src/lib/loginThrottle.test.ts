import { describe, it, expect } from 'vitest'
import { isLocked, minutesLeft, nextState, MAX_ATTEMPTS, LOCKOUT_MINUTES } from './loginThrottle'

const teraz = new Date('2026-08-31T12:00:00Z')
const za = (min: number) => new Date(teraz.getTime() + min * 60_000)

describe('blokada logowania — reguła', () => {
  it('brak wiersza to brak blokady', () => {
    expect(isLocked(null, teraz)).toBe(false)
    expect(minutesLeft(null, teraz)).toBe(0)
  })

  it('blokada w przyszłości blokuje, w przeszłości już nie', () => {
    expect(isLocked({ attempts: 5, lockedUntil: za(5) }, teraz)).toBe(true)
    expect(isLocked({ attempts: 5, lockedUntil: za(-1) }, teraz)).toBe(false)
  })

  it('licznik bez blokady nie blokuje, choćby był wysoki', () => {
    // Blokada wynika ze STEMPLA, nie z samego licznika: inaczej wygaśnięcie
    // kary wymagałoby dodatkowego zapisu, którego nikt by nie zrobił.
    expect(isLocked({ attempts: 99, lockedUntil: null }, teraz)).toBe(false)
  })

  it('kolejna nieudana próba podnosi licznik', () => {
    expect(nextState(null, teraz).attempts).toBe(1)
    expect(nextState({ attempts: 2, lockedUntil: null }, teraz).attempts).toBe(3)
  })

  it(`blokada wchodzi dokładnie przy ${MAX_ATTEMPTS} próbach, nie wcześniej`, () => {
    expect(nextState({ attempts: MAX_ATTEMPTS - 2, lockedUntil: null }, teraz).lockedUntil).toBeNull()
    const po = nextState({ attempts: MAX_ATTEMPTS - 1, lockedUntil: null }, teraz)
    expect(po.lockedUntil).not.toBeNull()
    expect(po.lockedUntil!.getTime()).toBe(teraz.getTime() + LOCKOUT_MINUTES * 60_000)
  })

  it('minuty do końca zaokrąglamy w górę, nigdy do zera', () => {
    expect(minutesLeft({ attempts: 5, lockedUntil: new Date(teraz.getTime() + 1000) }, teraz)).toBe(1)
    expect(minutesLeft({ attempts: 5, lockedUntil: za(14.2) }, teraz)).toBe(15)
  })
})
