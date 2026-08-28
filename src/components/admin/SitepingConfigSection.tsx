'use client'
import { useState } from 'react'
import { ChevronDown, Copy, Check, AlertTriangle } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildHtmlSnippet, buildWordPressSnippet } from '@/lib/siteping/snippet'

/**
 * Konfiguracja SitePinga w karcie projektu.
 *
 * Do tej pory `siteping_enabled` i `site_domains` dawało się ustawić WYŁĄCZNIE
 * curlem z tokenem, a kodu do wklejenia trzeba było szukać po repo. Sekcja
 * zamyka jedno i drugie.
 *
 * Zapis idzie tą samą trasą `PATCH /api/admin/portals`, co flagi zakładek
 * i marka — bez nowego wejścia i bez nowej walidacji. Walidacja domen zostaje
 * po stronie trasy CELOWO: to pole jest jednocześnie allowlistą `Origin` dla
 * `/api/siteping/[slug]`, więc jego rozluźnienie byłoby zmianą bezpieczeństwa,
 * nie kosmetyką.
 */
type Portal = {
  slug: string
  sitepingEnabled: boolean
  siteDomains: string | null
}

interface Props {
  portal: Portal
  /** Adres portalu do snippetu; w przeglądarce znamy go z `window`. */
  appUrl: string
  onSaved: (changes: Partial<Portal>) => void
}

export function SitepingConfigSection({ portal, appUrl, onSaved }: Props) {
  const [domeny, setDomeny] = useState(portal.siteDomains ?? '')
  const [zapisywanie, setZapisywanie] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [pokazKod, setPokazKod] = useState(false)
  const [wariant, setWariant] = useState<'wp' | 'html'>('wp')
  const [skopiowane, setSkopiowane] = useState(false)

  async function zapisz(changes: Partial<Portal>) {
    setZapisywanie(true)
    setBlad(null)
    try {
      const res = await fetch('/api/admin/portals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: portal.slug, ...changes }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        // Komunikat z trasy niesie powód odrzucenia domeny (schemat, ścieżka),
        // więc pokazujemy go wprost zamiast własnego „coś poszło nie tak".
        setBlad(d?.error?.fieldErrors?.siteDomains?.[0] ?? 'Nie udało się zapisać.')
        return
      }
      const { portal: zapisany } = await res.json()
      onSaved(zapisany)
      setDomeny(zapisany.siteDomains ?? '')
    } catch {
      setBlad('Brak połączenia z serwerem.')
    } finally {
      setZapisywanie(false)
    }
  }

  const kod = wariant === 'wp'
    ? buildWordPressSnippet({ slug: portal.slug, appUrl })
    : buildHtmlSnippet({ slug: portal.slug, appUrl })

  async function kopiuj() {
    await navigator.clipboard.writeText(kod)
    setSkopiowane(true)
    setTimeout(() => setSkopiowane(false), 2000)
  }

  const brakDomen = portal.sitepingEnabled && !portal.siteDomains

  return (
    <div className="space-y-3 border-b border-border/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          SitePing
        </span>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={portal.sitepingEnabled}
            disabled={zapisywanie}
            onChange={e => zapisz({ sitepingEnabled: e.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer accent-foreground"
          />
          Zgłoszenia ze strony klienta
        </label>

        <button
          type="button"
          onClick={() => setPokazKod(v => !v)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={pokazKod}
        >
          Kod do wklejenia
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${pokazKod ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[280px] flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Domeny strony klienta
          </span>
          <Input
            value={domeny}
            onChange={e => setDomeny(e.target.value)}
            onBlur={() => {
              if ((portal.siteDomains ?? '') !== domeny) zapisz({ siteDomains: domeny })
            }}
            placeholder="wodadlafirmy.pl, wdf.important.is"
            disabled={zapisywanie}
          />
          <span className="text-[10px] text-muted-foreground">
            Same nazwy hostów po przecinku, opcjonalnie z portem. Bez{' '}
            <code>https://</code> i bez ścieżki — to jest jednocześnie lista
            adresów, z których endpoint przyjmuje zgłoszenia.
          </span>
        </label>
      </div>

      {blad && <p className="text-xs text-destructive">{blad}</p>}

      {/*
        Ostrzeżenie o tagu jest widoczne ZAWSZE, także przy wyłączonej fladze:
        tag trzeba założyć ZANIM ktokolwiek włączy funkcję, a nie po tym, jak
        pierwsze zgłoszenie po cichu straci oznaczenie.
      */}
      <p className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          <strong className="text-foreground">Zanim włączysz:</strong> w przestrzeni
          ClickUp tego klienta muszą istnieć tagi <code>siteping</code>,{' '}
          <code>błąd</code>, <code>zmiana</code>, <code>pytanie</code>, <code>inne</code>.
          ClickUp <strong className="text-foreground">po cichu pomija</strong> nieznane
          nazwy tagów — zadanie powstanie bez oznaczenia, bez żadnego błędu.
        </span>
      </p>

      {brakDomen && (
        <p className="text-[11px] text-destructive">
          Funkcja jest włączona, ale bez domen endpoint pozostaje zamknięty.
          Zgłoszenia nie będą przyjmowane, dopóki nie uzupełnisz pola wyżej.
        </p>
      )}

      {pokazKod && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <Button
                variant={wariant === 'wp' ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setWariant('wp')}
              >
                WordPress
              </Button>
              <Button
                variant={wariant === 'html' ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setWariant('html')}
              >
                Zwykły HTML
              </Button>
            </div>

            <Button variant="ghost" size="xs" onClick={kopiuj} className="ml-auto">
              {skopiowane ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {skopiowane ? 'Skopiowane' : 'Kopiuj'}
            </Button>
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground">
            {wariant === 'wp' ? (
              <>
                Zapisz jako <code>wp-content/mu-plugins/siteping.php</code>. Wariant
                dla WordPressa <strong className="text-foreground">podstawia dane
                zgłaszającego</strong> z portalu, więc widget nie pyta go o imię
                ani adres. Osadza się tylko przy <code>?siteping</code> w adresie,
                żeby przycisk zgłaszania nie był widoczny dla wszystkich.
              </>
            ) : (
              <>
                Wklej przed <code>&lt;/body&gt;</code>. Ten wariant{' '}
                <strong className="text-foreground">nie podstawia tożsamości</strong>
                {' '}— widget zapyta zgłaszającego o imię i adres. Do stron, które
                nie są WordPressem.
              </>
            )}
          </p>

          <pre className="max-h-64 overflow-auto rounded bg-background p-2 text-[10px] leading-relaxed">
            <code>{kod}</code>
          </pre>

          <p className="text-[11px] leading-snug text-muted-foreground">
            <strong className="text-foreground">O zbieraniu konsoli:</strong>{' '}
            <code>captureDiagnostics</code> zapisuje ostatnie wpisy z konsoli strony
            klienta i jego nieudane żądania. Może tam być cokolwiek, co ta strona
            loguje, łącznie z danymi jego użytkowników; adresy niosą pełny query
            string. Treści odpowiedzi widget nie zbiera. To decyzja klienta —
            wystarczy usunąć tę linię.
          </p>
        </div>
      )}
    </div>
  )
}
