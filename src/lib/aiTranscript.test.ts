import { describe, it, expect } from 'vitest'
import {
  buildTranscript,
  claimsTaskCreated,
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
  it('samo dopytywanie to zwykła rozmowa, nie awaria', () => {
    const wynik = transcriptOutcome([
      { role: 'user', text: 'przycisk nie działa' },
      { role: 'assistant', text: 'Na której stronie? Wklej link, jeśli możesz.' },
    ])
    expect(wynik).toEqual({ outcome: 'rozmowa', taskId: null, taskName: null })
  })

  it('obietnica bez wywołania narzędzia to „podejrzane", nie „rozmowa"', () => {
    // Dokładnie zdarzenie z 30.08: klient czyta „dodane", zamyka okno i czeka
    // na coś, czego nie ma.
    const wynik = transcriptOutcome([
      { role: 'user', text: 'przycisk nie działa' },
      { role: 'assistant', text: 'Zadanie zostało dodane. Pojawi się na tablicy.' },
    ])
    expect(wynik.outcome).toBe('podejrzane')
  })

  it('gdy narzędzie zadziałało, obietnica jest prawdą i nic nie jest podejrzane', () => {
    const wynik = transcriptOutcome([
      { role: 'assistant', text: 'Zgłaszam to jako P2.' },
      { role: 'tool', tool: { name: 'createTask', input: {}, output: { success: true, taskId: '1', taskName: 'X' } } },
    ])
    expect(wynik.outcome).toBe('zadanie')
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

describe('claimsTaskCreated', () => {
  it('rozpoznaje obietnicę w czasie przeszłym i teraźniejszym', () => {
    expect(claimsTaskCreated('Zadanie zostało dodane.')).toBe(true)
    expect(claimsTaskCreated('Ja w międzyczasie zapisuję to jako zadanie.')).toBe(true)
    expect(claimsTaskCreated('dobra, zgłaszam jako P1. zadanie pojawi się za chwilę na tablicy')).toBe(true)
    expect(claimsTaskCreated('Zgłoszenie zostało zapisane, zespół to zweryfikuje.')).toBe(true)
  })

  it('pytanie o zgodę NIE jest obietnicą', () => {
    expect(claimsTaskCreated('Mam to zgłosić jako P2?')).toBe(false)
    expect(claimsTaskCreated('Czy zapisuję to jako zadanie?')).toBe(false)
  })

  it('zwykłe dopytywanie nie jest obietnicą', () => {
    expect(claimsTaskCreated('Na jakiej stronie to widzisz?')).toBe(false)
    expect(claimsTaskCreated('')).toBe(false)
    expect(claimsTaskCreated(null)).toBe(false)
  })

  it('pytanie na końcu nie unieważnia twierdzenia ze środka', () => {
    expect(claimsTaskCreated('Zadanie zostało dodane. Coś jeszcze?')).toBe(true)
  })
})
