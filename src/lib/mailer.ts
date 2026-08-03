/**
 * Wysyłka maili przez SMTP. Jedno miejsce, zamiast konfigurowania transportu
 * w każdej trasie osobno (dziś robi to /api/panic u siebie).
 *
 * Brak konfiguracji SMTP NIE jest błędem: lokalnie zmiennych nie ma, więc
 * `send` zwraca `{ sent: false, reason: 'not-configured' }` i wołający decyduje,
 * co z tym zrobić. Dzięki temu tworzenie użytkownika działa na dev bez
 * wysyłania czegokolwiek, a panel może pokazać link do skopiowania z ręki.
 */
/**
 * Adres, na który mają iść odpowiedzi na maile portalu. Nadpisywalny zmienną
 * MAIL_REPLY_TO. Skrzynka nadawcza jest techniczna i może być nieczytana,
 * a ten adres musi być czytany przez kogokolwiek z zespołu.
 */
const DEFAULT_REPLY_TO = 'hi@important.is'

export type SendResult =
  | { sent: true }
  | { sent: false; reason: 'not-configured' | 'error'; detail?: string }

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

export type MailKind = 'invite' | 'reset' | 'password-changed' | 'panic'

export async function sendMail(options: {
  to: string
  subject: string
  html: string
  /** Wersja tekstowa. Bez niej filtry antyspamowe są mniej łaskawe. */
  text?: string
  /** Rodzaj wiadomości, do rejestru w panelu. */
  kind?: MailKind
  /** Projekt, którego dotyczy. Null dla maili poza projektem. */
  portalId?: string | null
}): Promise<SendResult> {
  if (!isMailConfigured()) {
    await logMail(options, false, 'SMTP nie jest skonfigurowany', null)
    return { sent: false, reason: 'not-configured' }
  }

  try {
    const { createTransport } = await import('nodemailer')
    const port = Number(process.env.SMTP_PORT ?? 465)
    const transport = createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 to SMTPS (szyfrowanie od pierwszego bajtu), 587 to STARTTLS.
      secure: port === 465,
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    })

    const info = await transport.sendMail({
      from: `important.is <${process.env.SMTP_USER}>`,
      to: options.to,
      // Odpowiedzi idą do zespołu, nie do skrzynki automatu. Klient, który
      // dostaje zaproszenie do portalu, ODPISUJE na nie, bo to naturalna
      // reakcja na maila od firmy. Bez tego nagłówka odpowiedź trafia na adres
      // techniczny, którego nikt nie czyta na bieżąco, i wygląda dla klienta
      // jak zignorowana.
      replyTo: process.env.MAIL_REPLY_TO ?? DEFAULT_REPLY_TO,
      subject: options.subject,
      html: options.html,
      text: options.text,
    })

    // `info.response` to DOSŁOWNA odpowiedź serwera, np.
    // "250 2.0.0 OK: queued as <...>". Zapisujemy ją, bo odróżnia „przyjęte do
    // wysyłki" od „dostarczone": przekaźnik może przyjąć wiadomość i dopiero
    // potem odbić się od serwera odbiorcy. Bez tej linii nie da się powiedzieć,
    // czyj jest problem.
    await logMail(options, true, info?.response ?? null, info?.messageId ?? null)
    return { sent: true }
  } catch (e) {
    // Nieudana wysyłka nie może wywalić operacji, która ją wywołała
    // (np. tworzenia użytkownika). Wołający dostaje informację i decyduje.
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[mailer] wysyłka nieudana:', detail)
    await logMail(options, false, detail, null)
    return { sent: false, reason: 'error', detail }
  }
}

/**
 * Zapis do rejestru. NIGDY nie rzuca wyjątkiem i nigdy nie zmienia wyniku
 * wysyłki: mail albo poszedł, albo nie, a problem z zapisem historii nie ma
 * prawa tego przesłonić.
 *
 * Logujemy TUTAJ, a nie u wołających, żeby nie dało się o tym zapomnieć przy
 * dodaniu kolejnego rodzaju wiadomości. Rejestr, który trzeba pamiętać uzupełnić,
 * po pewnym czasie kłamie przez pominięcie.
 */
async function logMail(
  options: { to: string; subject: string; kind?: MailKind; portalId?: string | null },
  ok: boolean,
  detail: string | null,
  messageId: string | null
): Promise<void> {
  try {
    const { db } = await import('./db')
    const { mailLog } = await import('./db/schema')
    await db.insert(mailLog).values({
      portalId: options.portalId ?? null,
      recipient: options.to,
      kind: options.kind ?? 'invite',
      subject: options.subject,
      ok,
      detail,
      messageId,
    })
  } catch (e) {
    console.error('[mailer] nie udało się zapisać maila do rejestru:', e)
  }
}
