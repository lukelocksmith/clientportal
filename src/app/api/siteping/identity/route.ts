import { NextRequest, NextResponse } from 'next/server'
import { verifyIdentityToken } from '@/lib/siteping/identityToken'

/**
 * Wymiana tokenu z linku „Pokaż na stronie" na imię i mail zgłaszającego.
 *
 * Woła to STRONA KLIENTA, po swojej stronie serwera (w naszym przypadku
 * mu-plugin WordPressa przez `wp_remote_get`), i podaje wynik widgetowi
 * w `config.identity`. Widget mając te dane nie pyta o tożsamość ani razu.
 *
 * DLACZEGO SERWER STRONY, A NIE PRZEGLĄDARKA: gdyby token leciał tu z
 * JavaScriptu na stronie klienta, wynik i tak byłby przepisywany do widgetu
 * w przeglądarce, ale token krążyłby dodatkowo po froncie cudzej strony,
 * gdzie może go odczytać dowolny inny skrypt (analityka, wtyczki, GTM).
 * Zapytanie z serwera trzyma go poza zasięgiem tamtego kodu.
 *
 * ŚWIADOMIE BEZ CORS: ta trasa nie jest przeznaczona dla przeglądarki.
 * Brak nagłówków CORS jest tu funkcją, nie brakiem — próba wywołania jej
 * z frontu cudzej strony po prostu się nie uda.
 *
 * Odpowiedź NIGDY nie jest cache'owana: niesie dane osobowe i jest ważna
 * przez kwadrans.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const slug = request.nextUrl.searchParams.get('slug')

  if (!token || !slug) {
    return NextResponse.json({ error: 'Missing token or slug' }, { status: 400 })
  }

  const tozsamosc = await verifyIdentityToken(token, slug)

  // Jedna odpowiedź na wszystkie powody odrzucenia: wygasły, podrobiony,
  // wydany dla innego projektu. Rozróżnianie ich podpowiadałoby, którą
  // część atakujący zgadł.
  if (!tozsamosc) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  return NextResponse.json(
    // `token` wraca NIEZMIENIONY: skoro `verifyIdentityToken` go dopiero co
    // zweryfikował dla tego sluga, mu-plugin może go doczepić do configu
    // widgetu jako dowod tozsamosci (naglowek `Authorization` przy zgloszeniu),
    // zamiast kazac trasie [slug] ufac samemu polu `authorEmail` z cialka.
    { name: tozsamosc.name, email: tozsamosc.email, token },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
