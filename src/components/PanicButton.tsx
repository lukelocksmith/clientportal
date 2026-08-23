'use client'
import { useState } from 'react'
import { AlertTriangle, Send, CheckCircle2, XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  slug: string
}

type State = 'idle' | 'open' | 'sending' | 'sent' | 'error'

/**
 * Alarm dla agencji.
 *
 * Przepisany z ręcznego modalu na Dialog z Radiksa (przez shadcn), bo wersja
 * ręczna nie obsługiwała klawisza Escape, nie łapiła fokusa w oknie i nie
 * miała `aria-modal`. Przy funkcji, której klient używa w panice, zamknięcie
 * klawiszem i porządna obsługa czytnika ekranu to nie ozdoba.
 *
 * Kolory przeszły z zaszytych na sztywno (`bg-white`, `text-gray-600`) na
 * tokeny motywu. Poprzednia wersja wyglądałaby poprawnie tylko w trybie
 * jasnym, a `.dark` jest już zdefiniowany w globals.css i czeka na włączenie.
 *
 * Czerwień idzie przez `variant="destructive"`, nie przez zaszyte `bg-red-600`.
 * Token motywu to #ef4444 w jasnym i #dc2626 w ciemnym, oba jednoznacznie
 * czerwone, a wariant daje jedno miejsce na kolor alarmu i spójność z
 * pozostałymi akcjami niszczącymi w aplikacji.
 *
 * Stan `error` istnieje po tym, jak wysyłka mogła się cicho nie powieść:
 * klient klikał drugi raz bez informacji, czy cokolwiek poszło. Treść
 * wiadomości zostaje w polu, więc ponowna wysyłka nie wymaga przepisywania.
 */
export function PanicButton({ slug }: Props) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')


  async function handleSend() {
    if (!message.trim()) return
    setState('sending')
    try {
      const res = await fetch('/api/panic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, message }),
      })
      if (res.ok) {
        await res.json()
        setState('sent')
      } else {
        setState('error')
      }
    } catch {
      setState('error')
    }
  }

  function reset() {
    setState('idle')
    setMessage('')

  }

  const sending = state === 'sending'

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setState('open')}
        title="Wyślij alarm do agencji"
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <AlertTriangle className="h-4 w-4" />
        Alarm
      </Button>

      <Dialog
        open={state !== 'idle'}
        onOpenChange={next => {
          // Radix woła to także przy Escape i kliknięciu w tło. Podczas
          // wysyłania nie pozwalamy zamknąć, żeby klient nie stracił widoku
          // potwierdzenia w połowie żądania.
          if (!next && !sending) reset()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Alarm dla agencji
            </DialogTitle>
            {state !== 'sent' && state !== 'error' && (
              <DialogDescription>
                Opisz krótko, co się dzieje. Powiadomimy zespół natychmiast.
              </DialogDescription>
            )}
            {state === 'error' && (
              <DialogDescription className="text-destructive">
                Nie udało się wysłać zgłoszenia. Sprawdź połączenie i spróbuj ponownie.
              </DialogDescription>
            )}
          </DialogHeader>

          {state !== 'sent' && state !== 'error' && (
            <>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="np. Strona główna przestała działać, nie można składać zamówień"
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-destructive"
                rows={4}
                autoFocus
              />
              <DialogFooter className="sm:justify-between">
                <Button variant="outline" onClick={reset} disabled={sending}>
                  Anuluj
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleSend}
                  disabled={!message.trim() || sending}
                >
                  <Send className="h-4 w-4" />
                  {sending ? 'Wysyłanie...' : 'Wyślij alarm'}
                </Button>
              </DialogFooter>
            </>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <XCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
              <p className="font-semibold text-foreground">Zgłoszenie nie zostało wysłane.</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Treść wiadomości została zachowana. Możesz spróbować ponownie albo zadzwonić do nas.
              </p>
              <DialogFooter className="w-full sm:justify-between">
                <Button variant="outline" onClick={reset}>
                  Zamknij
                </Button>
                <Button variant="destructive" onClick={handleSend} disabled={!message.trim()}>
                  <Send className="h-4 w-4" />
                  Wyślij ponownie
                </Button>
              </DialogFooter>
            </div>
          )}

          {state === 'sent' && (
            <div className="py-4 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-500" />
              <p className="font-semibold text-foreground">Zgłoszenie wysłane!</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Zespół important został poinformowany. Skontaktują się z Tobą mailowo lub telefonicznie.
              </p>
              <Button variant="link" size="sm" onClick={reset} className="mt-4 text-muted-foreground">
                Zamknij
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
