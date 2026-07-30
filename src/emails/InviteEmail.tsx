import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

/**
 * Mail z zaproszeniem do portalu.
 *
 * Szablon w react-email, nie sklejany z ręki. Poprzedni wzorzec w tym repo
 * (maile panic) buduje HTML stringiem z inline'owymi stylami i własną funkcją
 * `esc()`, co znaczy, że każde nowe pole trzeba pamiętać zescapować. Tutaj
 * React robi to sam, a klienty pocztowe są obsłużone przez bibliotekę.
 *
 * `brandColor` przychodzi już zwalidowany (lib/branding.ts), więc wolno go
 * wstawić do stylu.
 */
interface InviteEmailProps {
  portalName: string
  /** Imię, jeśli znamy. Null daje neutralne powitanie. */
  recipientName: string | null
  inviteUrl: string
  expiresInHours: number
  brandColor: string
  brandForeground: string
}

export function InviteEmail({
  portalName,
  recipientName,
  inviteUrl,
  expiresInHours,
  brandColor,
  brandForeground,
}: InviteEmailProps) {
  const greeting = recipientName ? `Cześć ${recipientName},` : 'Cześć,'

  return (
    <Html lang="pl">
      <Head />
      {/* Podglad w skrzynce, zanim ktos otworzy maila. */}
      <Preview>Twój dostęp do portalu {portalName}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={{ ...header, backgroundColor: brandColor }}>
            <Heading style={{ ...headerText, color: brandForeground }}>{portalName}</Heading>
          </Section>

          <Section style={content}>
            <Text style={text}>{greeting}</Text>
            <Text style={text}>
              przygotowaliśmy dla Ciebie portal, w którym na bieżąco widzisz status swoich zgłoszeń,
              możesz zlecać nowe zadania i pisać do nas w każdej sprawie.
            </Text>
            <Text style={text}>
              Kliknij poniżej i ustaw swoje hasło. My go nie znamy i nie będziemy znać.
            </Text>

            <Button href={inviteUrl} style={{ ...button, backgroundColor: brandColor, color: brandForeground }}>
              Ustaw hasło i wejdź do portalu
            </Button>

            <Text style={muted}>
              Link jest jednorazowy i wygasa po {expiresInHours} godzinach. Jeśli straci ważność,
              napisz do nas, wyślemy nowy.
            </Text>
            <Text style={muted}>
              Jeśli nie spodziewałeś się tej wiadomości, zignoruj ją. Bez kliknięcia w link nic się
              nie stanie.
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>important.is</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default InviteEmail

// Style inline, bo klienty pocztowe nie obsluguja arkuszy zewnetrznych.
const body = { backgroundColor: '#f6f7f9', fontFamily: 'Helvetica, Arial, sans-serif', margin: 0 }
const container = { maxWidth: '560px', margin: '0 auto', padding: '24px 12px' }
const header = { borderRadius: '8px 8px 0 0', padding: '24px' }
const headerText = { fontSize: '20px', fontWeight: 700, margin: 0 }
const content = {
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  borderTop: '0',
  borderRadius: '0 0 8px 8px',
  padding: '24px',
}
const text = { fontSize: '15px', lineHeight: '24px', color: '#111827', margin: '0 0 14px' }
const button = {
  display: 'inline-block',
  padding: '12px 22px',
  borderRadius: '6px',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
  margin: '6px 0 18px',
}
const muted = { fontSize: '13px', lineHeight: '20px', color: '#6b7280', margin: '0 0 8px' }
const footer = { padding: '16px 4px 0' }
const footerText = { fontSize: '12px', color: '#9ca3af', margin: 0 }
