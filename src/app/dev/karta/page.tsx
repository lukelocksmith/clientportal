import { notFound } from 'next/navigation'
import { KartaPodglad } from './KartaPodglad'

/**
 * Podgląd karty kanbana na danych z palca, DOSTĘPNY TYLKO LOKALNIE.
 *
 * Powód istnienia: strony portalu wymagają Postgresa i sesji, więc na maszynie
 * bez bazy (a tak wygląda zwykły dzień pracy nad wyglądem) nie da się zobaczyć
 * ani jednej karty. Bez tej strony jedynym sposobem sprawdzenia zmiany w CSS
 * jest deploy na produkcję i patrzenie na dane klienta, co jest złą kolejnością.
 *
 * W produkcji strona nie istnieje: `notFound()` leci przed czymkolwiek innym.
 */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <KartaPodglad />
}
