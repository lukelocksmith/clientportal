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
 * Wspólna powłoka maili portalu: nagłówek w kolorze marki, treść, przycisk,
 * uwagi drobnym drukiem i stopka.
 *
 * Wyciągnięta, gdy doszedł drugi mail (odzyskiwanie hasła). Dwa razy ten sam
 * układ z inline'owymi stylami rozjechałby się przy pierwszej zmianie palety.
 *
 * `brandColor` i `brandForeground` przychodzą zwalidowane z lib/branding.ts,
 * więc wolno je wstawić do stylu.
 */
export interface EmailShellProps {
  portalName: string
  /** Tekst widoczny w skrzynce przed otwarciem maila. */
  preview: string
  greeting: string
  /** Akapity treści, każdy jako osobny element. */
  paragraphs: string[]
  buttonLabel: string
  buttonUrl: string
  /** Uwagi drobnym drukiem pod przyciskiem. */
  notes: string[]
  brandColor: string
  brandForeground: string
}

export function EmailShell({
  portalName,
  preview,
  greeting,
  paragraphs,
  buttonLabel,
  buttonUrl,
  notes,
  brandColor,
  brandForeground,
}: EmailShellProps) {
  return (
    <Html lang="pl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={{ ...header, backgroundColor: brandColor }}>
            <Heading style={{ ...headerText, color: brandForeground }}>{portalName}</Heading>
          </Section>

          <Section style={content}>
            <Text style={text}>{greeting}</Text>
            {paragraphs.map((p, i) => (
              <Text key={i} style={text}>
                {p}
              </Text>
            ))}

            <Button
              href={buttonUrl}
              style={{ ...button, backgroundColor: brandColor, color: brandForeground }}
            >
              {buttonLabel}
            </Button>

            {notes.map((n, i) => (
              <Text key={i} style={muted}>
                {n}
              </Text>
            ))}
          </Section>

          <Section style={footer}>
            <Text style={footerText}>important.is</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

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
