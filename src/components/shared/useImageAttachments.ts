'use client'
import { useCallback, useRef, useState } from 'react'

/**
 * Wspólny mechanizm „obrazów do wklejenia": wybór z dysku, wklejenie
 * ze schowka, miniaturki i limiter do 5 plików.
 *
 * Był skopiowany trzykrotnie (szuflada zadania, czat AI, pomysł na dashboard)
 * i każda kopia pilnowała revokeObjectURL po swojemu; jedna zapomniana
 * rewizja zostawiałaby wyciek pamięci w długiej sesji. Stan i sprzątanie są
 * teraz w jednym miejscu, a komponenty tylko renderują miniaturki.
 */
const MAX_PENDING = 5

export type PendingImage = { file: File; url: string }

export function useImageAttachments() {
  const [pending, setPending] = useState<PendingImage[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** Filtruje obrazy, dokleja do stanu i tnie do limitu. */
  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return
    const imgs = Array.from(list).filter(f => f.type.startsWith('image/'))
    if (!imgs.length) return
    setPending(prev =>
      [...prev, ...imgs.map(f => ({ file: f, url: URL.createObjectURL(f) }))].slice(0, MAX_PENDING)
    )
  }, [])

  /** Usuwa jeden wpis i zwalnia jego object URL. */
  const removeFile = useCallback((idx: number) => {
    setPending(prev => {
      const next = [...prev]
      const [gone] = next.splice(idx, 1)
      if (gone) URL.revokeObjectURL(gone.url)
      return next
    })
  }, [])

  /** Czyści całość (po wysyłce albo przy zamknięciu panelu). */
  const clearFiles = useCallback(() => {
    setPending(prev => {
      for (const p of prev) URL.revokeObjectURL(p.url)
      return []
    })
  }, [])

  /** Handler wklejenia: bierze obrazy ze schowka, resztę przepuszcza. */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData?.items ?? [])
        .filter(i => i.type.startsWith('image/'))
        .map(i => i.getAsFile())
        .filter((f): f is File => !!f)
      if (imgs.length) { e.preventDefault(); addFiles(imgs) }
    },
    [addFiles]
  )

  return { pending, addFiles, removeFile, clearFiles, fileInputRef, handlePaste }
}
