import { notFound } from 'next/navigation'
import { CommentBody } from '@/components/kanban/CommentBody'
import type { BlockNode } from '@/lib/commentBlocks'
import { applyTaskMentions } from '@/lib/commentMentions'
import { publicCommentBlocks } from '@/lib/publicComments'
import type { ClickUpComment } from '@/lib/types'

/**
 * PODGLĄD RENDEROWANIA KOMENTARZA. Strona wyłącznie deweloperska.
 *
 * Po co istnieje: formatowania komentarzy nie da się dziś obejrzeć na
 * prawdziwych danych, bo żaden komentarz oznaczony jako publiczny nie ma
 * obrazka, listy, tabeli ani bloku kodu (pomiar z 2026-08-24: 9 publicznych
 * komentarzy na 373, wszystkie prostym tekstem). Bez tej strony jedynym
 * sposobem sprawdzenia wyglądu byłoby dopisanie komentarza w ClickUpie klienta,
 * czyli ruszanie cudzych danych po to, żeby zobaczyć własny CSS.
 *
 * Bloki niżej to PRAWDZIWE kształty z API ClickUpa, zebrane z komentarzy
 * zespołu, ale z treścią wymyśloną na tę stronę. Przechodzą przez ten sam
 * `parseCommentBlocks`, co komentarze klientów, więc podglądasz parser, nie
 * ręcznie ułożone drzewo.
 *
 * `notFound()` na produkcji nie jest ostrożnością na zapas: portal klienta nie
 * ma prawa mieć strony z przykładowymi zadaniami i linkami.
 *
 *   npm run dev, potem http://localhost:3000/admin/podglad-komentarza
 *
 * Adres pod `/admin`, nie `/dev`: pierwszy segment ścieżki to w tym portalu
 * slug klienta, więc `/dev/...` proxy odsyłało do logowania portalu „dev".
 * `/admin` proxy przepuszcza bez sesji, a stroną i tak rządzi brama niżej.
 */

/** Adres własnego serwera: pliki podglądu leżą w `public/`. */
const BAZA = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** Wstawki dokładnie w formacie, w jakim oddaje je ClickUp. */
const WSTAWKI: unknown[] = [
  { text: 'Podsumowanie prac' },
  { text: '\n', attributes: { header: 2 } },

  { text: 'Zwykły akapit z ' },
  { text: 'pogrubieniem', attributes: { bold: true } },
  { text: ', ' },
  { text: 'kursywą', attributes: { italic: true } },
  { text: ', ' },
  { text: 'przekreśleniem', attributes: { strike: true } },
  { text: ' i ' },
  { text: 'npm run build', attributes: { code: true } },
  { text: ' w środku zdania.' },
  { text: '\n', attributes: { 'block-id': 'b1' } },

  { text: '[P] ' },
  { text: 'Link z etykietą: ' },
  { text: 'panel sklepu', attributes: { link: 'https://example.test/wp-admin/' } },
  { text: ', goły adres https://example.test/cennik oraz wzmianka o ' },
  { type: 'tag', text: '@Paulina Andrzejewska', user: { username: 'Paulina Andrzejewska' } },
  { text: '.' },
  { text: '\n', attributes: { 'block-id': 'b2' } },

  { text: 'Zadanie z tego portalu: ' },
  { text: 'zad-w-zakresie', type: 'task_mention', task_mention: { task_id: 'zad-w-zakresie' } },
  { text: ', a zadanie spoza portalu: ' },
  { text: 'zad-poza-zakresem', type: 'task_mention', task_mention: { task_id: 'zad-poza-zakresem' } },
  { text: '.' },
  { text: '\n', attributes: { 'block-id': 'b3' } },

  { text: 'Tak wygląda cytat z wiadomości klienta.' },
  { text: '\n', attributes: { blockquote: true } },

  { text: 'pierwszy punkt' },
  { text: '\n', attributes: { list: { list: 'bullet' } } },
  { text: 'drugi punkt' },
  { text: '\n', attributes: { list: { list: 'bullet' } } },

  { text: 'krok pierwszy' },
  { text: '\n', attributes: { list: { list: 'ordered' } } },
  { text: 'krok drugi' },
  { text: '\n', attributes: { list: { list: 'ordered' } } },

  { text: '.produkt__filtr { display: grid }' },
  { text: '\n', attributes: { 'code-block': { 'code-block': 'css' } } },
  { text: '/* gwiazdki **nie są** pogrubieniem w kodzie */' },
  { text: '\n', attributes: { 'code-block': { 'code-block': 'css' } } },

  {
    type: 'table-embed',
    'table-embed': {
      rows: [{ insert: { id: 'r1' } }, { insert: { id: 'r2' } }],
      columns: [{ insert: { id: 'c1' } }, { insert: { id: 'c2' } }],
      cells: {
        '1:1': { content: [{ insert: 'Co mierzyliśmy' }, { insert: '\n' }] },
        '1:2': { content: [{ insert: 'Wynik' }, { insert: '\n' }] },
        '2:1': { content: [{ insert: 'Odpowiedź serwera' }, { insert: '\n' }] },
        '2:2': { content: [{ insert: '1,15 s', attributes: { bold: true } }, { insert: '\n' }] },
      },
    },
  },

  { text: 'Zrzut ekranu w treści:' },
  { text: '\n', attributes: { 'block-id': 'b4' } },
  {
    text: 'zrzut.png',
    type: 'image',
    /**
     * Plik z `public/`, nie `data:`-URL. Parser ODRZUCA `data:` celowo:
     * `CommentBody` opakowuje obrazek linkiem, a kliknięty `data:image/svg+xml`
     * potrafi wykonać skrypt z wnętrza SVG. Podgląd nie jest powodem, żeby
     * rozluźniać tę bramę, więc obrazek idzie z naszego serwera.
     *
     * Plik leży na SAMYM WIERZCHU `public/`, nie w podkatalogu: proxy traktuje
     * pierwszy segment ścieżki jak slug portalu, więc `/cokolwiek/plik.svg`
     * bez sesji dostaje przekierowanie na logowanie, a nazwa z kropką na
     * pierwszym segmencie przechodzi.
     */
    image: { url: `${BAZA}/przyklad-zrzut-komentarza.svg`, title: 'zrzut.png', width: 480, height: 200 },
  },

  {
    text: 'pomiary.pdf',
    type: 'attachment',
    attachment: { title: 'pomiary.pdf', extension: 'pdf', url: 'https://example.test/pomiary.pdf' },
  },

  {
    type: 'frame',
    frame: { service: 'clickup_video', url: 'https://example.test/nagranie.mp4' },
    text: 'https://example.test/nagranie.mp4',
  },
]

/** Nazwy jak z serwera: zadanie w zakresie ma nazwę, zadanie spoza NIE MA. */
const NAZWY = new Map<string, string | null>([
  ['zad-w-zakresie', 'Drobne poprawki'],
  ['zad-poza-zakresem', null],
])

/**
 * Odczyt przez nawias, nie `process.env.NODE_ENV`.
 *
 * Bundlery (Vite w testach, Next w budowaniu) WKLEJAJĄ wartość `NODE_ENV` w
 * miejsce odwołania z kropką, więc bramy nie dałoby się sprawdzić testem:
 * podmiana zmiennej w teście nie ruszałaby już wklejonego napisu. Nawias
 * zostaje odczytem w czasie działania.
 */
function naProdukcji(): boolean {
  return process.env['NODE_ENV'] === 'production'
}

export default function PodgladKomentarza() {
  if (naProdukcji()) notFound()

  /**
   * `publicCommentBlocks`, nie sam parser: podgląd ma pokazywać to, co widzi
   * KLIENT, razem ze zdjęciem znacznika `[P]` i usunięciem wzmianek o osobach.
   * Gdyby szedł prosto z parsera, kłamałby dokładnie w tych dwóch miejscach.
   */
  const blocks: BlockNode[] = applyTaskMentions(
    publicCommentBlocks({ comment: WSTAWKI, comment_text: '' } as unknown as ClickUpComment),
    NAZWY
  )

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Podgląd renderowania komentarza</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Strona tylko lokalna. Na produkcji zwraca 404. Bloki przechodzą przez ten sam parser co
          komentarze klientów, więc widać tu wynik parsera, a nie ręcznie ułożone drzewo.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Odtwarzacz wideo i link do PDF wskazują na wymyślony adres, więc zgłoszą błąd wczytywania.
          Chodzi o to, jak taki blok wygląda i czy da się w niego kliknąć, nie o samo nagranie.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          W przykładzie są też dwie rzeczy, które MAJĄ zniknąć: znacznik <code>[P]</code> i
          oznaczenie osoby z zespołu. Jeśli którekolwiek widać niżej, to jest błąd.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <CommentBody blocks={blocks} slug="demo" />
      </div>

      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Drzewo bloków ({blocks.length})
        </summary>
        <pre className="mt-2 overflow-x-auto text-[11px] leading-snug text-muted-foreground">
          {JSON.stringify(blocks, null, 1)}
        </pre>
      </details>
    </main>
  )
}
