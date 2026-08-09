/**
 * Wyodrębnione z TaskDrawer.tsx, żeby dało się to przetestować bez montowania
 * całej szuflady. Renderuje opisy zadań i komentarze zespołu: `##`/`###`,
 * listy `-`/`*`, `**pogrubienie**`, linki, akapity. Bez pełnej biblioteki
 * markdown, bo zakres jest z rozmysłem wąski.
 */

// Turn plain URLs into clickable links inside a text run.
export function linkify(text: string, kp: string): React.ReactNode[] {
  const urlRe = /(https?:\/\/[^\s]+)/g
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <a key={`${kp}-a${i++}`} href={m[0]} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
        {m[0]}
      </a>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// Inline: **bold** + links.
export function renderInline(text: string, kp: string): React.ReactNode[] {
  return text.split('**').flatMap((part, i): React.ReactNode[] =>
    i % 2 === 1
      ? [<strong key={`${kp}-b${i}`}>{linkify(part, `${kp}-b${i}`)}</strong>]
      : linkify(part, `${kp}-t${i}`)
  )
}

// Minimal Markdown renderer for task descriptions: ## / ### headings, - / * bullets,
// **bold**, links, paragraphs. Avoids pulling in a full markdown dependency.
export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let bullets: string[] = []
  const flush = (key: string) => {
    if (bullets.length) {
      const items = bullets
      blocks.push(
        <ul key={key} className="list-disc pl-5 space-y-0.5 my-1.5 text-sm text-foreground">
          {items.map((li, i) => <li key={i}>{renderInline(li, `${key}-${i}`)}</li>)}
        </ul>
      )
      bullets = []
    }
  }
  lines.forEach((line, idx) => {
    const key = `l${idx}`
    if (/^###\s+/.test(line)) {
      flush(`${key}f`)
      blocks.push(<h5 key={key} className="text-xs font-semibold text-foreground mt-2 mb-0.5">{renderInline(line.replace(/^###\s+/, ''), key)}</h5>)
    } else if (/^##\s+/.test(line)) {
      flush(`${key}f`)
      blocks.push(<h4 key={key} className="text-sm font-semibold text-foreground mt-3 mb-1 first:mt-0">{renderInline(line.replace(/^##\s+/, ''), key)}</h4>)
    } else if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ''))
    } else if (line.trim() === '') {
      flush(`${key}f`)
    } else {
      flush(`${key}f`)
      blocks.push(<p key={key} className="text-sm text-foreground leading-relaxed my-1">{renderInline(line, key)}</p>)
    }
  })
  flush('end')
  return <div>{blocks}</div>
}
