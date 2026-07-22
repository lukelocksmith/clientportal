import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return ''
  const date = new Date(Number(dateString))
  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
}

export function getPriorityLabel(priority: string | null | undefined): string {
  const map: Record<string, string> = {
    urgent: 'Pilne',
    high: 'Wysokie',
    normal: 'Normalne',
    low: 'Niskie',
  }
  return priority ? (map[priority] ?? priority) : ''
}

export function getPriorityColor(priority: string | null | undefined): string {
  const map: Record<string, string> = {
    urgent: '#f50000',
    high: '#f8ae00',
    normal: '#6fddff',
    low: '#d8d8d8',
  }
  return priority ? (map[priority] ?? '#d8d8d8') : '#d8d8d8'
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    backlog: '#87909e',
    'do zrobienia': '#e16b16',
    'w trakcie': '#F4BF44',
    zablokowane: '#d33d44',
    zrobione: '#1090e0',
    zamknięte: '#008844',
  }
  return map[status] ?? '#87909e'
}

export function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/**
 * Format a duration in milliseconds (ClickUp time_estimate / time_spent) as
 * a compact human string, e.g. 23400000 -> "6h 30m", 2700000 -> "45m".
 * Returns '' for null/undefined/0 so callers can conditionally render.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return ''
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes === 0) return '' // below a minute — don't show "0m"
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}
