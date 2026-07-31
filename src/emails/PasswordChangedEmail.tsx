import { EmailShell } from './EmailShell'

/**
 * Powiadomienie o zmianie hasła. Wysyłane PO fakcie, na adres konta.
 *
 * To nie jest uprzejmość, to zabezpieczenie. Link do ustawienia hasła jest
 * jednorazowy, ale trafia mailem, a skrzynka jest tym, co przeciwnik przechwytuje
 * najczęściej. Bez tego powiadomienia przejęcie konta jest CICHE: prawdziwy
 * właściciel dowiaduje się dopiero wtedy, gdy jego hasło przestaje działać, a
 * do tego czasu ktoś inny czyta jego zgłoszenia.
 *
 * Mail nie zawiera żadnego tokenu ani hasła i nie prosi o kliknięcie, żeby
 * „potwierdzić zmianę". Przycisk prowadzi do zwykłego logowania. Wiadomość,
 * która wymaga akcji, uczy odbiorcę klikać w maile o haśle, a to jest dokładnie
 * ten nawyk, na którym żeruje phishing.
 */
interface PasswordChangedEmailProps {
  portalName: string
  recipientName: string | null
  /** Adres strony logowania portalu. */
  loginUrl: string
  /** Data i godzina zmiany, gotowa do wyświetlenia, w czasie polskim. */
  changedAt: string
  /** Adres kontaktowy do zgłoszenia, że to nie był właściciel konta. */
  contactEmail: string
  brandColor: string
  brandForeground: string
}

export function PasswordChangedEmail({
  portalName,
  recipientName,
  loginUrl,
  changedAt,
  contactEmail,
  brandColor,
  brandForeground,
}: PasswordChangedEmailProps) {
  return EmailShell({
    portalName,
    brandColor,
    brandForeground,
    preview: `Hasło do portalu ${portalName} zostało zmienione`,
    greeting: recipientName ? `Cześć ${recipientName},` : 'Cześć,',
    paragraphs: [
      `hasło do Twojego konta w portalu ${portalName} zostało zmienione ${changedAt}.`,
      'Jeśli to Ty, nic więcej nie musisz robić. Ta wiadomość jest tylko potwierdzeniem.',
    ],
    buttonLabel: 'Przejdź do portalu',
    buttonUrl: loginUrl,
    notes: [
      // Konkretne polecenie zamiast „skontaktuj się z administratorem": odbiorca
      // w panice ma wiedzieć, gdzie napisać, bez szukania adresu.
      `Jeśli zmiana hasła NIE pochodzi od Ciebie, napisz natychmiast na ${contactEmail}. Zablokujemy dostęp do konta i sprawdzimy, co się stało.`,
      'Nie prosimy w mailach o hasło ani o jego potwierdzenie. Jeśli dostaniesz taką wiadomość, nie odpowiadaj na nią.',
    ],
  })
}

export default PasswordChangedEmail
