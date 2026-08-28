'use client'
import { useState } from 'react'
import { CheckCircle2, Loader2, Lightbulb, Paperclip, X } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { useImageAttachments } from '@/components/shared/useImageAttachments'

const MIN_LENGTH = 10

/**
 * „Masz pomysł, jak ulepszyć portal?" na Dashboardzie.
 *
 * Pomysł staje się zadaniem w naszej liście w ClickUpie, więc pętla zwrotna
 * jest zamknięta: klient pisze, my to widzimy tam, gdzie i tak pracujemy.
 *
 * Po wysłaniu pole NIE wraca do stanu początkowego, tylko pokazuje
 * potwierdzenie. Formularz gotowy do kolejnego wpisu sugerowałby, że pierwszy
 * się nie zapisał, a przy funkcji, z której korzysta się raz na kilka tygodni,
 * taki sygnał kończy się dublami.
 */
export function IdeaForm({ slug }: { slug: string }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { pending: pendingFiles, addFiles, removeFile, clearFiles, fileInputRef, handlePaste } = useImageAttachments()

  const tooShort = text.trim().length > 0 && text.trim().length < MIN_LENGTH

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (text.trim().length < MIN_LENGTH || sending) return
    setError(null)
    setSending(true)
    try {
      const form = new FormData()
      form.append('slug', slug)
      form.append('text', text.trim())
      pendingFiles.forEach(p => form.append('files', p.file))
      const res = await fetch('/api/portal-ideas', { method: 'POST', body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Nie udało się wysłać. Spróbuj ponownie.')
        return
      }
      clearFiles()
      setDone(true)
    } catch {
      setError('Brak połączenia. Spróbuj ponownie.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="py-2 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
        <p className="text-sm font-medium text-foreground">Dzięki, mamy to.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pomysł trafił prosto do naszej listy zadań. Jeśli będziemy mieć pytania, napiszemy.
        </p>
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            setDone(false)
            setText('')
          }}
          className="mt-2 text-muted-foreground"
        >
          Dodaj kolejny
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onPaste={handlePaste}
        rows={4}
        maxLength={2000}
        placeholder="np. przydałby się filtr po dacie w Historii, albo powiadomienie mailem, gdy zadanie zmieni status"
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />

      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pendingFiles.map((p, i) => (
            <div key={p.url} className="relative h-14 w-14 rounded-md overflow-hidden border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.file.name} className="h-full w-full object-cover block" />
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label="Usuń obraz"
                className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/60 text-white flex items-center justify-center"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {tooShort && (
        <p className="text-xs text-muted-foreground">Napisz jeszcze kilka słów, żebyśmy zrozumieli.</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { addFiles(e.target.files); e.target.value = '' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || pendingFiles.length >= 5}
          title="Dołącz obraz"
          aria-label="Dołącz obraz"
          className="inline-flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 disabled:pointer-events-none h-9 w-9 flex-shrink-0"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <Button type="submit" size="sm" disabled={text.trim().length < MIN_LENGTH || sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
          {sending ? 'Wysyłanie...' : 'Wyślij pomysł'}
        </Button>
      </div>
    </form>
  )
}
