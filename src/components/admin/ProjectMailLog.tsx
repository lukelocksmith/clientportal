'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from '@/lib/icons'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Rejestr wysłanych maili w karcie projektu.
 *
 * Odpowiada na pytanie, które przyszło z życia: klient mówi, że nie dostał
 * zaproszenia, i trzeba wiedzieć, czy mail w ogóle wyszedł, zanim zacznie się
 * szukać w jego skrzynce.
 *
 * Kolumna „Odpowiedź serwera" jest tu najważniejsza i dlatego jest szeroka.
 * `250 OK: queued as ...` znaczy „przyjęte do wysyłki", a NIE „dostarczone":
 * przekaźnik może przyjąć wiadomość i dopiero potem odbić się od serwera
 * odbiorcy. Bez tej linii nie da się powiedzieć, czyj jest problem.
 */
type Mail = {
  id: string
  recipient: string
  kind: string
  subject: string
  ok: boolean
  detail: string | null
  messageId: string | null
  createdAt: string
}

const KIND_LABELS: Record<string, string> = {
  invite: 'Zaproszenie',
  reset: 'Odzyskanie hasła',
  'password-changed': 'Zmiana hasła',
  panic: 'Alarm',
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

export function ProjectMailLog({ slug }: { slug: string }) {
  const [mails, setMails] = useState<Mail[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/mail-log?slug=${encodeURIComponent(slug)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { mails: Mail[] }) => {
        if (cancelled) return
        setMails(d.mails ?? [])
        setError(null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('Nie udało się pobrać rejestru poczty.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (loading) return <p className="px-4 py-6 text-xs text-muted-foreground">Ładowanie rejestru...</p>
  if (error) return <p className="px-4 py-6 text-xs text-destructive">{error}</p>

  const nieudane = mails.filter(m => !m.ok).length

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Co portal wysłał i co odpowiedział serwer pocztowy.{' '}
        <span className="text-foreground">Przyjęte do wysyłki nie znaczy dostarczone</span>: odpowiedź{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-[11px]">250 OK</code> pochodzi od przekaźnika, a ten
        może dopiero potem odbić się od serwera odbiorcy.
        {nieudane > 0 && (
          <span className="ml-1 text-destructive">Nieudanych wysyłek: {nieudane}.</span>
        )}
      </p>

      {mails.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
          Rejestr jest pusty. Zapisujemy w nim każdą wysyłkę od momentu wdrożenia tej funkcji, więc maile
          wysłane wcześniej się tu nie pojawią.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-36">Kiedy</TableHead>
                <TableHead className="w-52">Do kogo</TableHead>
                <TableHead className="w-36">Rodzaj</TableHead>
                <TableHead>Odpowiedź serwera</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mails.map(m => (
                <TableRow key={m.id}>
                  <TableCell>
                    {m.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {fmt(m.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs text-foreground">{m.recipient}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {KIND_LABELS[m.kind] ?? m.kind}
                  </TableCell>
                  <TableCell className={`text-xs ${m.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
                    <span className="line-clamp-2 font-mono text-[11px]">{m.detail ?? '—'}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
