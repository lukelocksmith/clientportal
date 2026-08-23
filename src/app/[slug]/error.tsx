'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Granica błędu dla segmentu portalu. Nieprzechwycony wyjątek w RSC (padnięta
 * baza, błąd ClickUpa poza try/catch) dawał domyślny ekran produkcyjny Nexta
 * ("Application error"), który wygląda jak awaria całej aplikacji i nie daje
 * klientowi żadnej akcji.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[portal] błąd renderowania strony:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <div>
        <h1 className="text-lg font-semibold text-foreground">Coś poszło nie tak</h1>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
          Strona nie mogła się wczytać. Spróbuj ponownie — jeśli problem się powtarza,
          napisz do nas przez przycisk Alarm albo na hi@important.is.
        </p>
      </div>
      <Button onClick={reset}>Spróbuj ponownie</Button>
    </div>
  )
}
