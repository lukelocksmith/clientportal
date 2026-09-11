import { notFound } from 'next/navigation'
import { ZgloszeniePodglad } from './ZgloszeniePodglad'

/**
 * Podgląd dróg zgłoszenia, DOSTĘPNY TYLKO LOKALNIE.
 *
 * Ten sam powód co przy podglądzie karty: formularz i pasek awaryjny żyją
 * wewnątrz tablicy klienta, więc żeby je zobaczyć, trzeba mieć bazę, sesję
 * i projekt — albo patrzeć na produkcji na dane klienta, co jest złą
 * kolejnością. Tutaj oba widać na danych z palca, bez logowania.
 *
 * W produkcji strona nie istnieje: `notFound()` leci przed czymkolwiek innym.
 */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <ZgloszeniePodglad />
}
