import { describe, it, beforeEach, expect } from 'vitest'
import { wolnoAlarmowac, zapomnijDlawienie, OKNO_MS } from './alertThrottle'

/**
 * Dławienie alarmów. Powstało 14.09, po tym jak seria moich własnych pomiarów
 * wysłała zespołowi czternaście wiadomości pod rząd na kanał, na którym stoją
 * prawdziwe alarmy klientów.
 */
beforeEach(() => zapomnijDlawienie())

describe('wolnoAlarmowac', () => {
  it('pierwszy alarm zawsze przechodzi', () => {
    expect(wolnoAlarmowac('blad-x')).toBe(true)
  })

  it('powtórka tego samego klucza milczy w oknie', () => {
    const t = 1_000_000
    expect(wolnoAlarmowac('blad-x', t)).toBe(true)
    expect(wolnoAlarmowac('blad-x', t + 1)).toBe(false)
    expect(wolnoAlarmowac('blad-x', t + OKNO_MS - 1)).toBe(false)
  })

  it('po oknie problem przypomina o sobie', () => {
    // Trwająca awaria ma się odzywać, a nie zniknąć po jednym alarmie.
    const t = 1_000_000
    expect(wolnoAlarmowac('blad-x', t)).toBe(true)
    expect(wolnoAlarmowac('blad-x', t + OKNO_MS)).toBe(true)
  })

  it('różne problemy nie zagłuszają się nawzajem', () => {
    const t = 1_000_000
    expect(wolnoAlarmowac('blad-x', t)).toBe(true)
    expect(wolnoAlarmowac('blad-y', t)).toBe(true)
    expect(wolnoAlarmowac('blad-z', t)).toBe(true)
  })

  it('dwa wywołania w tej samej milisekundzie dają JEDEN alarm', () => {
    // Decyzja zapisuje się od razu, więc równoległe trasy nie przepuszczą
    // dwóch wiadomości o tym samym.
    const t = 2_000_000
    const wyniki = [wolnoAlarmowac('rownolegly', t), wolnoAlarmowac('rownolegly', t)]
    expect(wyniki.filter(Boolean)).toHaveLength(1)
  })

  it('pamięć nie rośnie w nieskończoność przy wielu wariantach klucza', () => {
    // Zepsuta pętla albo atakujący potrafią wyprodukować tysiące różnych
    // komunikatów; pamięć procesu ma zostać stała.
    const t = 3_000_000
    for (let i = 0; i < 2000; i++) wolnoAlarmowac(`wariant-${i}`, t + i)
    // Najstarsze klucze wypadły, więc pierwszy z nich znów przechodzi.
    expect(wolnoAlarmowac('wariant-0', t + 2001)).toBe(true)
  })

  it('zapomnijDlawienie odblokowuje wszystko', () => {
    const t = 4_000_000
    expect(wolnoAlarmowac('blad-x', t)).toBe(true)
    expect(wolnoAlarmowac('blad-x', t + 1)).toBe(false)
    zapomnijDlawienie()
    expect(wolnoAlarmowac('blad-x', t + 2)).toBe(true)
  })

  it('okno jest na tyle długie, żeby nie zalać kanału, i na tyle krótkie, żeby nie uśpić', () => {
    // Trzydzieści minut: przy awarii w pętli to najwyżej dwie wiadomości na
    // godzinę, a przy trwającym problemie zespół dostaje przypomnienie
    // zanim skończy się dyżur.
    expect(OKNO_MS).toBe(30 * 60 * 1000)
  })
})
