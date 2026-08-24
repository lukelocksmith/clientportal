import type { BlockNode, InlineNode } from '@/lib/commentBlocks'
import { linkify } from './MarkdownLite'

/**
 * Treść komentarza z ClickUpa. Renderuje drzewo bloków z `lib/commentBlocks`.
 *
 * Zastępuje `MarkdownLite` w komentarzach. MarkdownLite czytał `comment_text`,
 * czyli spłaszczony tekst, i szukał w nim markdownu, którego ClickUp tam nigdy
 * nie stawia: wzmianka o zadaniu wychodziła gołym identyfikatorem, obrazek
 * napisem `image.png`, a listy, kod, cytaty i linki z etykietą przepadały
 * (zgłoszone 2026-08-24). W opisach zadań MarkdownLite zostaje, bo tam źródłem
 * jest pole `description`, które markdown NAPRAWDĘ zawiera.
 *
 * `linkify` jest wspólne z MarkdownLite: goły adres wpisany w zdanie ma być
 * klikalny także tutaj, a to jedna i ta sama reguła.
 */
export function CommentBody({ blocks, slug }: { blocks: BlockNode[]; slug: string }) {
  return (
    <div className="space-y-1.5">
      {blocks.map((block, index) => (
        <Block key={index} block={block} slug={slug} index={index} />
      ))}
    </div>
  )
}

function Block({ block, slug, index }: { block: BlockNode; slug: string; index: number }) {
  const key = `b${index}`

  switch (block.kind) {
    case 'paragraph':
      // Pusty akapit to odstęp autora, więc zostawiamy mu wysokość linii.
      if (block.inline.length === 0) return <div className="h-2" />
      return (
        <p className="text-sm leading-relaxed text-foreground">
          <Inline nodes={block.inline} slug={slug} kp={key} />
        </p>
      )

    case 'heading': {
      const className =
        block.level === 1
          ? 'text-sm font-semibold text-foreground mt-3 first:mt-0'
          : block.level === 2
            ? 'text-sm font-semibold text-foreground mt-2 first:mt-0'
            : 'text-xs font-semibold text-foreground mt-2 first:mt-0'
      const content = <Inline nodes={block.inline} slug={slug} kp={key} />
      if (block.level === 1) return <h4 className={className}>{content}</h4>
      if (block.level === 2) return <h5 className={className}>{content}</h5>
      return <h6 className={className}>{content}</h6>
    }

    case 'quote':
      return (
        <blockquote className="border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
          <Inline nodes={block.inline} slug={slug} kp={key} />
        </blockquote>
      )

    case 'bullets':
      return (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline nodes={item} slug={slug} kp={`${key}-${i}`} />
            </li>
          ))}
        </ul>
      )

    case 'ordered':
      return (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-foreground">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline nodes={item} slug={slug} kp={`${key}-${i}`} />
            </li>
          ))}
        </ol>
      )

    case 'code':
      return (
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-2 text-xs">
          <code>{block.lines.join('\n')}</code>
        </pre>
      )

    case 'image':
      return (
        <a href={block.url} target="_blank" rel="noopener noreferrer" className="block">
          {/* next/image wymagałby wpisania hosta ClickUpa do konfiguracji, a
              adresy załączników są jednorazowe i nieprzewidywalne. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.url}
            alt={block.name}
            className="max-h-80 max-w-full rounded-md border border-border object-contain"
          />
        </a>
      )

    case 'file':
      return (
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted"
        >
          <span className="truncate">{block.name}</span>
        </a>
      )

    case 'video':
      return (
        <video
          src={block.url}
          controls
          preload="metadata"
          className="max-h-80 max-w-full rounded-md border border-border"
        />
      )

    case 'table': {
      const [head, ...body] = block.rows
      return (
        // Szerokość tabeli w komentarzu jest spoza naszej kontroli, więc
        // przewija się w swoim pudełku, a nie rozpycha całej szuflady.
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            {head && (
              <thead>
                <tr>
                  {head.map((cell, i) => (
                    <th key={i} className="border border-border bg-muted/50 px-2 py-1 text-left font-semibold">
                      <Inline nodes={cell} slug={slug} kp={`${key}-h${i}`} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-border px-2 py-1 align-top">
                      <Inline nodes={cell} slug={slug} kp={`${key}-${r}-${c}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
  }
}

function Inline({ nodes, slug, kp }: { nodes: InlineNode[]; slug: string; kp: string }) {
  return (
    <>
      {nodes.map((node, i) => (
        <InlineNodeView key={`${kp}-${i}`} node={node} slug={slug} kp={`${kp}-${i}`} />
      ))}
    </>
  )
}

function InlineNodeView({ node, slug, kp }: { node: InlineNode; slug: string; kp: string }) {
  if (node.kind === 'mention') {
    /**
     * Oznaczenie osoby NIE JEST treścią dla klienta: ktoś z zespołu oznaczył
     * kogoś, żeby ClickUp go zawiadomił, a klient widział z tego samo nazwisko
     * wiszące nad odpowiedzią (zgłoszone 2026-08-24). Wypada już w
     * `publicCommentBlocks`, razem ze zszyciem tekstu wokół.
     *
     * Ta gałąź istnieje, żeby renderer był zupełny, a nie żeby cokolwiek
     * pokazać: gdyby wzmianka jakąkolwiek drogą tu dotarła, klient i tak nie
     * zobaczy nazwiska.
     */
    return null
  }

  if (node.kind === 'taskMention') {
    /**
     * Bez nazwy = zadanie poza portalem tego klienta. Serwer świadomie jej nie
     * przysłał (patrz lib/commentMentions.ts), więc nie ma tu czego pokazać ani
     * gdzie linkować. Identyfikator też nie, bo to on był treścią zgłoszenia.
     */
    if (!node.name) return <span className="text-muted-foreground">inne zadanie</span>

    /**
     * Zwykły `<a>`, nie `next/link`: klikając wzmiankę klient przechodzi na
     * inne zadanie, a szuflada jest sterowana parametrem adresu w KanbanBoard.
     * Pełne przejście daje poprawny stan bez przenoszenia sterowania szufladą
     * do tego komponentu.
     */
    return (
      <a
        href={`/${slug}?task=${node.taskId}`}
        className="font-medium text-primary underline decoration-dotted"
      >
        {node.name}
      </a>
    )
  }

  const content = node.link ? node.text : linkify(node.text, kp)
  let element = <>{content}</>
  if (node.code) element = <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{element}</code>
  if (node.strike) element = <s>{element}</s>
  if (node.italic) element = <em>{element}</em>
  if (node.bold) element = <strong>{element}</strong>

  if (node.link) {
    return (
      <a
        href={node.link}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline break-all"
      >
        {element}
      </a>
    )
  }
  return element
}
