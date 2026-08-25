'use client'
import { useEffect, useState } from 'react'

type Member = { id: number; username: string; email: string | null }

/**
 * Kto dostaje zadania zakładane z portalu.
 *
 * Lista pochodzi z ClickUpa (`/api/admin/portals/members`), nie z naszej
 * `TEAM_MEMBERS`: przypisanie musi wskazywać konto ISTNIEJĄCE w workspace,
 * bo id spoza niego wywala CAŁE żądanie utworzenia zadania — inaczej niż zły
 * tag, który ClickUp po cichu pomija. Wybór z listy zamyka drogę literówce,
 * która zablokowałaby zakładanie zgłoszeń.
 *
 * Pusty wybór znaczy „jak w agencji", czyli osoba z
 * `CLICKUP_DEFAULT_ASSIGNEE_ID`. To jest stan DOMYŚLNY i poprawny: wyjątek
 * ustawia się tylko tam, gdzie projekt prowadzi kto inny.
 */
export function AssigneePicker({
  value,
  onChange,
}: {
  value: number | null
  onChange: (next: number | null) => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [stan, setStan] = useState<'ladowanie' | 'ok' | 'blad'>('ladowanie')

  useEffect(() => {
    let anulowane = false
    fetch('/api/admin/portals/members')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        if (anulowane) return
        setMembers(d.members ?? [])
        setStan('ok')
      })
      .catch(() => {
        if (!anulowane) setStan('blad')
      })
    return () => {
      anulowane = true
    }
  }, [])

  /**
   * Gdy ClickUp nie odpowie, pokazujemy to WPROST i nie czyścimy ustawienia.
   * Puste pole wyboru wyglądałoby jak „nikt nie jest przypisany" i kusiłoby do
   * zapisania tej nieprawdy jednym kliknięciem.
   */
  if (stan === 'blad') {
    return (
      <p className="text-xs text-destructive">
        Nie udało się pobrać listy osób z ClickUpa. Ustawienie zostaje bez zmian
        {value !== null && ` (obecnie: #${value})`}.
      </p>
    )
  }

  const znany = value === null || members.some(m => m.id === value)

  return (
    <div className="space-y-1">
      <select
        value={value ?? ''}
        disabled={stan === 'ladowanie'}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full max-w-md rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
      >
        <option value="">Jak w agencji (domyślna osoba)</option>
        {members.map(m => (
          <option key={m.id} value={m.id}>
            {m.username}
          </option>
        ))}
        {/* Ustawiona osoba, której nie ma już w workspace: pokazujemy ją
            zamiast po cichu przestawiać wybór na „jak w agencji". */}
        {!znany && <option value={value!}>#{value} (spoza workspace)</option>}
      </select>

      <p className="text-[11px] text-muted-foreground">
        Dotyczy zadań zakładanych z portalu: formularz, AI-chat, pomysł, widget na stronie.
        Alarm ma własną regułę i idzie do osoby dyżurnej.
      </p>
    </div>
  )
}
