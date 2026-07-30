import { EmailShell } from './EmailShell'
import type { InviteKind } from '@/lib/invites'
import { pluralForm, HOURS_LOCATIVE } from '@/lib/plural'

/**
 * Mail z linkiem dostępowym: pierwsze zaproszenie albo odzyskiwanie hasła.
 *
 * Jeden komponent na oba przypadki, bo różnią się wyłącznie treścią, a układ
 * jest wspólny (EmailShell). Treść musi się jednak różnić naprawdę, nie
 * kosmetycznie: klient, który sam poprosił o reset, czyta co innego niż klient,
 * który pierwszy raz dowiaduje się o istnieniu portalu.
 */
interface AccessEmailProps {
  kind: InviteKind
  portalName: string
  /** Imię, jeśli znamy. Null daje neutralne powitanie, nigdy "Cześć null". */
  recipientName: string | null
  actionUrl: string
  expiresInHours: number
  brandColor: string
  brandForeground: string
}

export function AccessEmail({
  kind,
  portalName,
  recipientName,
  actionUrl,
  expiresInHours,
  brandColor,
  brandForeground,
}: AccessEmailProps) {
  const greeting = recipientName ? `Cześć ${recipientName},` : 'Cześć,'
  const isReset = kind === 'reset'

  // Po przyimku „po" idzie miejscownik: „po godzinie", „po godzinach".
  const godzin = pluralForm(expiresInHours, HOURS_LOCATIVE)

  return EmailShell({
    portalName,
    brandColor,
    brandForeground,
    greeting,
    preview: isReset
      ? `Zmiana hasła do portalu ${portalName}`
      : `Twój dostęp do portalu ${portalName}`,
    paragraphs: isReset
      ? [
          'dostaliśmy prośbę o zmianę hasła do Twojego konta w portalu.',
          'Kliknij poniżej i ustaw nowe hasło. My go nie znamy i nie będziemy znać.',
        ]
      : [
          'przygotowaliśmy dla Ciebie portal, w którym na bieżąco widzisz status swoich zgłoszeń, możesz zlecać nowe zadania i pisać do nas w każdej sprawie.',
          'Kliknij poniżej i ustaw swoje hasło. My go nie znamy i nie będziemy znać.',
        ],
    buttonLabel: isReset ? 'Ustaw nowe hasło' : 'Ustaw hasło i wejdź do portalu',
    buttonUrl: actionUrl,
    notes: isReset
      ? [
          `Link jest jednorazowy i wygasa po ${expiresInHours} ${godzin}.`,
          // Kluczowe zdanie przy resecie: prośbę mógł wysłać ktoś inny,
          // a odbiorca musi wiedzieć, że nic się nie stało bez kliknięcia.
          'Jeśli nie prosiłeś o zmianę hasła, zignoruj tę wiadomość. Twoje obecne hasło nadal działa i nikt go nie zmienił.',
        ]
      : [
          `Link jest jednorazowy i wygasa po ${expiresInHours} ${godzin}. Jeśli straci ważność, napisz do nas, wyślemy nowy.`,
          'Jeśli nie spodziewałeś się tej wiadomości, zignoruj ją. Bez kliknięcia w link nic się nie stanie.',
        ],
  })
}

export default AccessEmail
