/**
 * Kanały powiadomień alarmowych: Discord, mail i SMS.
 *
 * Wyciągnięte z trasy `/api/panic`, bo od 2026-08-13 są dwa miejsca, które
 * wysyłają to samo: wciśnięcie przycisku i eskalacja po 25 oraz 50 minutach
 * bez reakcji. Bez wspólnego modułu druga ścieżka byłaby kopią pierwszej,
 * a kopie się rozjeżdżają akurat tam, gdzie najmniej można sobie na to
 * pozwolić.
 *
 * Wszystkie funkcje są BEST-EFFORT: żadna nie rzuca wyjątkiem, bo przy alarmie
 * padnięty kanał nie może wywrócić ani zgłoszenia klienta, ani przebiegu cronu.
 */
import { sendMail } from './mailer'
import { parsePhoneList, sendSmsToMany } from './sms'

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Odbiorcy alarmu mailem. Na produkcji ustawione przez PANIC_EMAIL_TO.
 *
 * Zapas to JEDEN adres skrzynki, która na pewno istnieje. Wcześniej stały tu
 * `filip@important.is` i `paulina@important.is`, a na serwerze pocztowym są
 * `filip.g@` i `paulina.a@`. Gdyby ktoś usunął zmienną, alarm poszedłby na
 * dwa nieistniejące adresy i odbiłby się w ciszy.
 */
function emailRecipients(): string[] {
  const raw = process.env.PANIC_EMAIL_TO ?? 'hi@important.is'
  return raw.split(',').map(e => e.trim()).filter(Boolean)
}

export async function sendPanicDiscord(content: string): Promise<void> {
  const webhook = process.env.PANIC_DISCORD_WEBHOOK_URL
  if (!webhook) return
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch(() => {})
}

/**
 * Mail alarmowy przez WSPÓLNY mailer, nie przez własny transport, żeby każda
 * wysyłka trafiła do rejestru. Osobne wywołanie na odbiorcę, nie jedno z listą:
 * chcemy wiedzieć, do kogo dotarło, a nie tylko że „coś wyszło".
 */
export async function sendPanicEmails(input: {
  subject: string
  html: string
  portalId: string
}): Promise<void> {
  await Promise.allSettled(
    emailRecipients().map(to =>
      sendMail({ to, subject: input.subject, html: input.html, kind: 'panic', portalId: input.portalId })
    )
  )
}

/**
 * SMS do zespołu. Odbiorcy siedzą w `PANIC_SMS_TO`, a nie w `TEAM_MEMBERS`:
 * to dwie różne listy, dziś przypadkiem te same osoby. `TEAM_MEMBERS` to
 * kontakt POKAZYWANY klientowi, a tu chodzi o to, kogo wyrwać od stołu.
 * Pusta zmienna wyłącza kanał, bez błędu.
 */
export async function sendPanicSms(input: { text: string; portalId: string }): Promise<void> {
  const numery = parsePhoneList(process.env.PANIC_SMS_TO)
  if (numery.length === 0) return
  await sendSmsToMany({ to: numery, text: input.text, kind: 'panic', portalId: input.portalId })
}

/** Wspólna ramka maila alarmowego. Czerwony pasek, treść, kto zgłasza, przycisk. */
export function panicEmailHtml(input: {
  title: string
  portalName: string
  message: string
  who: string
  /** Zdanie nad treścią, gdy mail jest ponowieniem, a nie pierwszym alarmem. */
  lead?: string
  button?: { url: string; label: string }
  /** Link do zadania w ClickUpie. Przy eskalacji obowiązkowy. */
  taskUrl?: string | null
  footer?: string
}): string {
  const przycisk = input.button
    ? `<a href="${escapeHtml(input.button.url)}" style="display:inline-block;background:#ef4444;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px">
          ${escapeHtml(input.button.label)}
        </a>`
    : ''
  const zadanie = input.taskUrl
    ? `<p style="font-size:14px;color:#374151;margin:12px 0 0">
          <strong>Zadanie w ClickUpie:</strong>
          <a href="${escapeHtml(input.taskUrl)}" style="color:#ef4444">${escapeHtml(input.taskUrl)}</a>
        </p>`
    : ''
  const lead = input.lead
    ? `<p style="font-size:15px;color:#b91c1c;margin-top:0;font-weight:600">${escapeHtml(input.lead)}</p>`
    : ''

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#ef4444;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:24px">${escapeHtml(input.title)}</h1>
        <p style="margin:8px 0 0;opacity:0.9">${escapeHtml(input.portalName)}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px">
        ${lead}
        <p style="font-size:16px;color:#111827;margin-top:0">${escapeHtml(input.message)}</p>
        <p style="font-size:14px;color:#374151;margin:0">
          <strong>Zgłasza:</strong> ${escapeHtml(input.who)}
        </p>
        ${zadanie}
        ${przycisk}
        ${input.footer ? `<p style="color:#6b7280;font-size:12px;margin-top:24px">${escapeHtml(input.footer)}</p>` : ''}
      </div>
    </div>
  `
}
