'use client'
import { useState } from 'react'
import type { ClickUpTask } from '@/lib/types'
import { X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface NewTaskFormProps {
  slug: string
  onClose: () => void
  onTaskCreated: (task: ClickUpTask) => void
}

const PRIORITIES = [
  { value: 1, label: 'Pilne', color: '#f50000' },
  { value: 2, label: 'Wysokie', color: '#f8ae00' },
  { value: 3, label: 'Normalne', color: '#6fddff' },
  { value: 4, label: 'Niskie', color: '#d8d8d8' },
]

export function NewTaskForm({ slug, onClose, onTaskCreated }: NewTaskFormProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<number | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    const res = await fetch('/api/clickup/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        name: name.trim(),
        description: description.trim() || undefined,
        priority: priority || undefined,
        due_date: dueDate ? new Date(dueDate).getTime() : undefined,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      onTaskCreated(data.task)
    } else {
      const data = await res.json()
      toast.error(data.error ?? 'Nie udało się dodać zadania')
    }
    setLoading(false)
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-card rounded-xl border border-border shadow-2xl z-50">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-foreground">Nowe zadanie</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Nazwa zadania <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
              placeholder="Co trzeba zrobić?"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Opis (opcjonalnie)
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Dodatkowe informacje, linki, wymagania..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Priorytet
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(priority === p.value ? null : p.value)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                    priority === p.value
                      ? 'text-white border-transparent'
                      : 'border-border text-muted-foreground hover:border-border/60'
                  }`}
                  style={priority === p.value ? { backgroundColor: p.color, borderColor: p.color } : {}}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Due date */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Termin (opcjonalnie)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors h-9"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors h-9"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Dodawanie...' : 'Dodaj zadanie'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
