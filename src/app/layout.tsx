import type { Metadata } from 'next'
import { Rubik, Geist_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

// Rubik jest jedynym fontem w designie important.is (skill important-brand).
// Portal jechal na Geiscie z create-next-app, czyli na foncie spoza brandu.
// latin-ext jest KONIECZNE dla polskich znakow: bez niego ą, ć, ę, ł, ń, ś, ź, ż
// leca na font zapasowy i tekst rozjezdza sie w polowie wyrazu.
const rubik = Rubik({ variable: '--font-brand-sans', subsets: ['latin', 'latin-ext'] })
const geistMono = Geist_Mono({ variable: '--font-brand-mono', subsets: ['latin'] })

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${rubik.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
