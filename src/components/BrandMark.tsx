/**
 * Dyskretny znak important.is, wstawiany na stronach portalu.
 *
 * Świadomie MAŁY i drugoplanowy. Portal nosi markę KLIENTA: jego kolor i logo
 * są w nagłówku, bo to jego portal, a nie nasza wizytówka. Wstawianie naszego
 * logo obok jego logo kazałoby tym dwóm markom konkurować w miejscu, gdzie
 * klient przychodzi po swoje zadania.
 *
 * Zamiast tego jesteśmy tam, gdzie marka nie walczy z brandem klienta:
 * w tytule karty przeglądarki, w ikonie, w stopce maili i tutaj, jako podpis
 * „dostarcza". Ten sam wzorzec, co „powered by" w narzędziach białoetykietowych.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <p className={className ?? 'text-center text-xs text-muted-foreground'}>
      Portal dostarcza{' '}
      <a
        href="https://important.is"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-foreground transition-colors hover:text-primary"
      >
        important.is
      </a>
    </p>
  )
}
