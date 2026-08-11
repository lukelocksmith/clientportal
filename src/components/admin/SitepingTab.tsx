'use client'
import { SitepingConfigSection } from '@/components/admin/SitepingConfigSection'
import { SitepingCheck } from '@/components/admin/SitepingCheck'

/**
 * Zakładka „SitePing" w karcie projektu.
 *
 * DLACZEGO OSOBNA ZAKŁADKA, a nie sekcja w „Konfiguracji": SitePing przestał
 * być jednym przełącznikiem. Ma własną konfigurację, kod do wklejenia na cudzą
 * stronę i test połączenia, czyli tyle treści co „Synchronizacja" albo
 * „Poczta" — a wciśnięty między checkboxy zakładek portalu i markę projektu
 * rozpychał kartę i gubił się w niej.
 *
 * Doszedł do tego drugi powód, praktyczny: pytanie „czemu klientowi nie
 * dochodzą zgłoszenia" jest pytaniem o JEDNO miejsce w panelu. Konfiguracja
 * i test muszą stać obok siebie, bo odpowiedź prawie zawsze jest w jednym
 * z nich (wyłączona flaga, puste domeny, brakujący tag).
 *
 * Treść montuje się dopiero po wejściu w zakładkę — Radix nie renderuje
 * nieaktywnych — więc obecność tej zakładki nic nie kosztuje pozostałym.
 */
type Portal = {
  slug: string
  sitepingEnabled: boolean
  siteDomains: string | null
}

interface Props {
  portal: Portal
  onSaved: (changes: Partial<Portal>) => void
}

export function SitepingTab({ portal, onSaved }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <SitepingConfigSection
        portal={portal}
        // Adres portalu bierzemy z przeglądarki, a nie ze zmiennej środowiskowej:
        // ten sam panel chodzi lokalnie i na produkcji, a kod do wklejenia musi
        // wskazywać ten adres, pod którym admin właśnie pracuje.
        appUrl={typeof window === 'undefined' ? '' : window.location.origin}
        onSaved={onSaved}
      />
      <SitepingCheck slug={portal.slug} />
    </div>
  )
}
