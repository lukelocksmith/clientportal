import { Loader2 } from 'lucide-react'

/**
 * Szkielet ładowania dla wszystkich zakładek portalu. Strony tego segmentu
 * są serwerowe i część z nich czeka na ClickUpa (raporty, dashboard): bez
 * tej granicy nawigacja po prostu stawała na czas pobrania, a klient nie
 * wiedział, czy strona działa.
 */
export default function PortalLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Ładowanie...</p>
    </div>
  )
}
