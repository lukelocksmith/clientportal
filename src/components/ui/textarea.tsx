import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, value, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement>(null)

    // Rosnie z trescia zamiast recznego rozciagania (jak w ClickUpie) — klient
    // zglosil, ze stale pole komentarza jest za male, zeby widziec co sie pisze.
    // Dziala na KAZDA zmiane `value`, wiec obejmuje i pisanie, i programowe
    // czyszczenie po wyslaniu/anulowaniu (textarea wraca do min-height).
    React.useLayoutEffect(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }, [value])

    return (
      <textarea
        value={value}
        ref={node => {
          innerRef.current = node
          if (typeof forwardedRef === 'function') forwardedRef(node)
          else if (forwardedRef) forwardedRef.current = node
        }}
        className={cn(
          'flex min-h-9 max-h-64 w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
