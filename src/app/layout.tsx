import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Rubik } from 'next/font/google'
import { Toaster } from 'sonner'
import { skryptMotywu } from '@/lib/theme'
import './globals.css'

// Rubik jest jedynym fontem w designie important.is (skill important-brand).
// Portal jechal na Geiscie z create-next-app, czyli na foncie spoza brandu.
// latin-ext jest KONIECZNE dla polskich znakow: bez niego ą, ć, ę, ł, ń, ś, ź, ż
// leca na font zapasowy i tekst rozjezdza sie w polowie wyrazu.
const rubik = Rubik({ variable: '--font-brand-sans', subsets: ['latin', 'latin-ext'] })


export const metadata: Metadata = {
  // Szablon dokleja marke do kazdej podstrony, ktora ustawi wlasny tytul,
  // wiec important.is jest w kazdej karcie przegladarki bez ruszania layoutu.
  title: {
    default: 'Portal klienta · important.is',
    template: '%s · important.is',
  },
  description: 'Portal klienta agencji important.is: zgłoszenia, historia i kontakt z zespołem.',
  applicationName: 'important.is',
  authors: [{ name: 'important.is', url: 'https://important.is' }],
  // Portal jest za logowaniem, wiec nie ma czego indeksowac.
  robots: { index: false, follow: false },
}

/**
 * Stempluje nonce na arkuszach tworzonych z JS.
 *
 * Biblioteki wstrzykują `<style>` przez `document.createElement`, bez nonce'a,
 * bo nie mają skąd go wziąć. Przy `style-src 'self' 'nonce-...'` przeglądarka
 * blokuje taki arkusz i pisze o tym tylko w konsoli: interfejs po prostu
 * wygląda źle, bez żadnego błędu (sonner, powiadomienia bez stylu, 2026-08-24).
 *
 * Łata jest wąska z rozmysłem: dotyka WYŁĄCZNIE tagu `style` i tylko dokłada
 * atrybut. Wykonuje się przed paczkami aplikacji, bo skrypt bez `defer` w
 * treści strony rusza od razu przy parsowaniu.
 */
const STEMPEL_NONCE = (nonce: string) =>
  `(function(){try{var d=document,c=d.createElement.bind(d);d.createElement=function(t){` +
  `var e=c.apply(d,arguments);if(String(t).toLowerCase()==='style'){e.setAttribute('nonce','${nonce}')}return e}}catch(e){}})()`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce wystawia proxy w nagłówku żądania, ten sam, który trafia do CSP.
  const nonce = (await headers()).get('x-nonce') ?? ''

  return (
    /**
     * `suppressHydrationWarning` na <html>: skrypt motywu niżej dokłada tu
     * klasę `dark` i `color-scheme` PRZED hydracją, więc React zawsze zastanie
     * atrybuty inne niż te, które wyrenderował serwer. Serwer nie ma jak tego
     * przewidzieć — motyw jest informacją wyłącznie z przeglądarki.
     */
    <html lang="pl" className={`${rubik.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        {/**
          * MOTYW PRZED PIERWSZYM MALOWANIEM. Skrypt bez `defer` wykonuje się
          * przy parsowaniu, czyli zanim cokolwiek zostanie narysowane — dlatego
          * ustawienie motywu tutaj, a nie w komponencie. Komponent działa po
          * malowaniu, więc dawałby białe mignięcie przy każdym wejściu.
          *
          * Nonce jest KONIECZNY: CSP portalu ma `script-src 'self' 'nonce-...'`
          * bez `unsafe-inline`, więc skrypt bez nonce'a zostałby po cichu
          * zablokowany i motyw wracałby do jasnego przy każdym odświeżeniu.
          */}
        {nonce && (
          <script
            nonce={nonce}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: skryptMotywu() }}
          />
        )}
        {nonce && (
          /**
           * `suppressHydrationWarning` jest tu KONIECZNE, nie kosmetyczne.
           * Przeglądarka po wczytaniu strony CZYŚCI atrybut `nonce` (element
           * zachowuje wartość tylko we właściwości), więc React porównuje
           * `nonce="..."` z serwera z `nonce=""` w DOM i zgłasza rozjazd
           * hydracji przy każdym wejściu na stronę.
           */
          <script
            nonce={nonce}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: STEMPEL_NONCE(nonce) }}
          />
        )}
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
