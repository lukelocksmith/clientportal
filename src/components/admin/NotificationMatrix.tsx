'use client'
import {
  NOTIFY_EVENTS,
  NOTIFY_EVENT_LABELS,
  type NotificationConfig,
  type NotifyChannel,
} from '@/lib/notifyConfig'

/**
 * Macierz powiadomień projektu: wiersz to zdarzenie, kolumna to kanał.
 *
 * Ustawia ją ADMIN, nie klient. Wszystko odznaczone znaczy „ten projekt nie
 * wysyła powiadomień", i tak jest domyślnie w każdym projekcie.
 *
 * Kolumna SMS jest widoczna i NIEAKTYWNA. Producent SMS-a nie obsługuje, a
 * klient portalu nie ma nawet numeru telefonu w bazie. Kratka, którą da się
 * zaznaczyć i która nic nie robi, jest gorsza niż wyraźnie wyłączona: ktoś by
 * ją zaznaczył, obiecał klientowi SMS-y i nikt by nie zauważył, że nie chodzą.
 */

const KOLUMNY: Array<{ channel: NotifyChannel | 'sms'; label: string; disabled?: boolean }> = [
  { channel: 'bell', label: 'Powiadomienie' },
  { channel: 'mail', label: 'E-mail' },
  { channel: 'sms', label: 'SMS', disabled: true },
]

export function NotificationMatrix({
  config,
  onChange,
}: {
  config: NotificationConfig
  onChange: (next: NotificationConfig) => void
}) {
  function toggle(event: (typeof NOTIFY_EVENTS)[number], channel: NotifyChannel, on: boolean) {
    const kanaly = { ...(config[event] ?? {}) }
    if (on) kanaly[channel] = true
    else delete kanaly[channel]

    const next: NotificationConfig = { ...config }
    // Zdarzenie bez żadnego kanału wypada z macierzy, żeby „nic nie zaznaczone"
    // miało jeden zapis, a nie obiekt pełen fałszów.
    if (Object.keys(kanaly).length > 0) next[event] = kanaly
    else delete next[event]

    onChange(next)
  }

  return (
    <div className="max-w-md">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="py-1 text-left font-medium text-muted-foreground">Zdarzenie</th>
            {KOLUMNY.map(k => (
              <th key={k.channel} className="w-24 py-1 text-center font-medium text-muted-foreground">
                {k.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NOTIFY_EVENTS.map(event => (
            <tr key={event} className="border-t border-border/60">
              <td className="py-1.5 pr-2 text-foreground">{NOTIFY_EVENT_LABELS[event]}</td>
              {KOLUMNY.map(k => (
                <td key={k.channel} className="py-1.5 text-center">
                  <input
                    type="checkbox"
                    // Etykieta niesie kanał I zdarzenie, bo sama kratka w tabeli
                    // nie mówi czytnikowi ekranu (ani testowi), czego dotyczy.
                    aria-label={`${k.label}: ${NOTIFY_EVENT_LABELS[event]}`}
                    disabled={k.disabled}
                    checked={k.disabled ? false : config[event]?.[k.channel as NotifyChannel] === true}
                    onChange={e =>
                      k.disabled ? undefined : toggle(event, k.channel as NotifyChannel, e.target.checked)
                    }
                    className="h-3.5 w-3.5 cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        SMS jeszcze nie działa: portal nie ma numeru telefonu klienta. Powiadomienie widać w
        dzwonku w portalu, e-mail idzie do osoby, która zgłosiła zadanie.
      </p>
    </div>
  )
}
