'use client'
import { useState } from 'react'
import { CheckCircle2, XCircle, Minus, Loader2, Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CheckRow, CheckState } from '@/lib/siteping/check'

/**
 * Test połączenia SitePinga: odpowiedź na „czemu klientowi nie dochodzą
 * zgłoszenia", bez wchodzenia na serwer.
 *
 * NA PRZYCISK, nie automatycznie po wejściu w zakładkę. Sprawdzenie wychodzi
 * do ClickUpa i na stronę klienta, więc uruchamianie go przy każdym otwarciu
 * panelu generowałoby ruch na cudze serwery bez powodu.
 *
 * TRZY STANY, NIE DWA — i to jest tu najważniejsze. `unknown` znaczy „nie
 * udało się sprawdzić" i ma myślnik, nigdy czerwony krzyżyk. Pokazanie
 * krzyżyka wysyłałoby naprawiać coś, o czym nie wiemy, czy jest zepsute,
 * a to gorsze niż brak testu.
 */
const IKONY: Record<CheckState, { Icon: typeof CheckCircle2; klasa: string; opis: string }> = {
  ok: { Icon: CheckCircle2, klasa: 'text-green-500', opis: 'w porządku' },
  fail: { Icon: XCircle, klasa: 'text-destructive', opis: 'nie działa' },
  unknown: { Icon: Minus, klasa: 'text-muted-foreground', opis: 'nie udało się sprawdzić' },
}

export function SitepingCheck({ slug }: { slug: string }) {
  const [rows, setRows] = useState<CheckRow[] | null>(null)
  const [trwa, setTrwa] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  async function sprawdz() {
    setTrwa(true)
    setBlad(null)
    try {
      const res = await fetch(`/api/admin/siteping/check?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) {
        setBlad('Nie udało się wykonać sprawdzenia.')
        return
      }
      const dane = await res.json()
      setRows(dane.rows)
    } catch {
      setBlad('Brak połączenia z serwerem.')
    } finally {
      setTrwa(false)
    }
  }

  // Bez `border-b`: to ostatnia sekcja karty, tak jak PortalConfigForm
  // w Konfiguracji. Kreska na dole wyglądałaby na uciętą treść.
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Test połączenia
        </span>
        <Button variant="outline" size="xs" onClick={sprawdz} disabled={trwa} className="ml-auto">
          {trwa ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
          )}
          {trwa ? 'Sprawdzam...' : 'Sprawdź teraz'}
        </Button>
      </div>

      {blad && <p className="text-xs text-destructive">{blad}</p>}

      {rows === null && !blad && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Sprawdza cztery rzeczy naraz: przełącznik, domeny, tagi w przestrzeni ClickUp
          i obecność widgetu na każdej ze stron klienta. Pobiera przy tym stronę klienta,
          więc trwa kilka sekund.
        </p>
      )}

      {rows !== null && (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {rows.map(row => {
            const { Icon, klasa, opis } = IKONY[row.state]
            return (
              <li key={row.key} className="flex items-start gap-2 px-3 py-2">
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${klasa}`} aria-label={opis} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{row.label}</p>
                  {/* Sam kolor nie odpowiada na pytanie „no dobrze, a co teraz",
                      więc zdanie z powodem jest częścią wyniku, nie dodatkiem. */}
                  <p className="text-[11px] leading-snug text-muted-foreground">{row.detail}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
