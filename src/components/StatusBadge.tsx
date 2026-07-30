import { getStatusColor } from '@/lib/utils'

/**
 * Pigułka statusu. Wyciągnięta z ReportView, bo Historia potrzebuje jej też,
 * a dwie kopie tego samego `${color}1f` rozjechałyby się przy pierwszej
 * zmianie palety.
 *
 * `1f` na końcu koloru to alfa w zapisie ośmioznakowym (~12%), czyli to samo
 * tło co obwódka, tylko przygaszone. Kolory statusów pochodzą z ClickUpa
 * przez getStatusColor, więc pigułka wygląda tak samo jak na kanbanie.
 */
export function StatusBadge({ status }: { status: string }) {
  const color = getStatusColor(status)
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      {status}
    </span>
  )
}
