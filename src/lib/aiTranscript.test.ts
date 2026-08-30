import { describe, it, expect } from 'vitest'
import {
  buildTranscript,
  stepTurns,
  textFromParts,
  transcriptOutcome,
  userTurns,
  MAX_TEXT_CHARS,
} from './aiTranscript'

describe('textFromParts', () => {
  it('skleja części tekstowe i pomija resztę', () => {
    expect(textFromParts([{ type: 'text', text: 'Nie działa' }, { type: 'file', url: 'x' }])).toBe('Nie działa')
  })

  it('nie wywraca się na czymkolwiek innym niż tablica', () => {
    expect(textFromParts(undefined)).toBe('')
    expect(textFromParts('tekst')).toBe('')
  })
})

describe('userTurns', () => {
  it('bierze tylko wiadomości klienta', () => {
    const turns = userTurns([
      { role: 'user', parts: [{ type: 'text', text: 'przycisk nie działa' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'rozumiem' }] },
    ])
    expect(turns).toEqual([{ role: 'user', text: 'przycisk nie działa' }])
  })

  it('ucina bardzo długą wypowiedź zamiast ją gubić', () => {
    const [turn] = userTurns([{ role: 'user', parts: [{ type: 'text', text: 'a'.repeat(MAX_TEXT_CHARS + 500) }] }])
    expect(turn.text!.length).toBeLessThan(MAX_TEXT_CHARS + 50)
    expect(turn.text).toContain('[ucięte]')
  })
})

describe('stepTurns', () => {
  const udanyKrok = [
    {
      text: 'Dodaję zadanie.',
      toolCalls: [{ toolCallId: 'c1', toolName: 'createTask', input: { name: 'Przycisk nie działa' } }],
      toolResults: [{ toolCallId: 'c1', toolName: 'createTask', output: { success: true, taskId: '869x', taskName: 'Przycisk nie działa' } }],
    },
  ]

  it('zapisuje wypowiedź modelu i wywołanie narzędzia', () => {
    expect(stepTurns(udanyKrok)).toEqual([
      { role: 'assistant', text: 'Dodaję zadanie.' },
      {
        role: 'tool',
        tool: {
          name: 'createTask',
          input: { name: 'Przycisk nie działa' },
          output: { success: true, taskId: '869x', taskName: 'Przycisk nie działa' },
        },
      },
    ])
  })

  it('rozpoznaje odmowę narzędzia jako błąd, nie jako sukces', () => {
    const turns = stepTurns([
      {
        toolCalls: [{ toolCallId: 'c1', toolName: 'createTask', input: {} }],
        toolResults: [{ toolCallId: 'c1', output: { error: 'Brak skonfigurowanej listy w portalu' } }],
      },
    ])
    expect(turns[0].tool?.error).toBe('Brak skonfigurowanej listy w portalu')
  })

  it('zapisuje wywołanie, którego wynik nie wrócił', () => {
    const turns = stepTurns([{ toolCalls: [{ toolCallId: 'c9', toolName: 'createTask', input: { name: 'x' } }] }])
    expect(turns).toHaveLength(1)
    expect(turns[0].tool?.output).toBeUndefined()
  })
})

describe('transcriptOutcome', () => {
  it('rozmowa bez narzędzia to nie jest awaria, ale to widać', () => {
    const wynik = transcriptOutcome([
      { role: 'user', text: 'przycisk nie działa' },
      { role: 'assistant', text: 'Zadanie zostało dodane.' },
    ])
    expect(wynik).toEqual({ outcome: 'rozmowa', taskId: null, taskName: null })
  })

  it('udane utworzenie zwraca identyfikator zadania', () => {
    const turns = buildTranscript(
      [{ role: 'user', parts: [{ type: 'text', text: 'nie działa' }] }],
      [
        {
          toolCalls: [{ toolCallId: 'c1', toolName: 'createTask', input: { name: 'X' } }],
          toolResults: [{ toolCallId: 'c1', output: { success: true, taskId: '869epb486', taskName: 'X' } }],
        },
      ]
    )
    expect(transcriptOutcome(turns)).toEqual({ outcome: 'zadanie', taskId: '869epb486', taskName: 'X' })
  })

  it('błąd narzędzia wygrywa z brakiem wyniku', () => {
    const wynik = transcriptOutcome([
      { role: 'tool', tool: { name: 'createTask', input: {}, error: 'ClickUp 401' } },
    ])
    expect(wynik.outcome).toBe('blad')
  })
})
