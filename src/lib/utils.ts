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
