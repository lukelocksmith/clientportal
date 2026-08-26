import { SITEPING_TOKEN_PARAM } from '../portalSite'

/**
 * Kod osadzenia widgetu, generowany per projekt.
 *
 * CZYSTY moduł: panel jest komponentem klienckim, więc nie może przez import
 * wciągnąć bazy do paczki przeglądarki. Ten błąd raz już położył aplikację.
 *
 * UWAGA, DLACZEGO TO NIE JEST DWA ZNACZNIKI `<script>`. Spec z 2026-08-10
 * opisywał zwykły snippet HTML, ale od tamtej pory doszło PODSTAWIANIE
 * TOŻSAMOŚCI (`sp_token` + `/api/siteping/identity`), które wymaga wymiany
 * tokenu PO STRONIE SERWERA strony klienta. Snippet ze specu dałby dziś
 * widget pytający klienta o imię i mail — czyli dokładnie to, co tamta zmiana
 * usunęła. Stąd wariant PHP jako główny: klienci siedzą na WordPressie.
 */

export type SnippetInput = {
  slug: string
  /** Adres portalu, bez ukośnika na końcu. */
  appUrl: string
}

function bezUkosnika(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Prosty wariant: sam widget, BEZ podstawiania tożsamości.
 *
 * Widget zapyta zgłaszającego o imię i adres przy pierwszym zgłoszeniu.
 * Do stron, które nie są WordPressem, i do szybkiego sprawdzenia, czy
 * cokolwiek działa.
 */
export function buildHtmlSnippet({ slug, appUrl }: SnippetInput): string {
  const base = bezUkosnika(appUrl)
  return `<script src="${base}/siteping/widget.js"></script>
<script>
  window.SitePing.initSiteping({
    endpoint: '${base}/api/siteping/${slug}',
    projectName: '${slug}',
    enableScreenshot: true,
    // WYMAGANE. Bez tego link „Zobacz na stronie" z zadania w ClickUpie
    // otworzy stronę i NICZEGO nie podświetli.
    deepLink: true,
    // Zbiera konsolę i nieudane żądania z chwili zgłoszenia.
    // Usuń tę linię, jeśli klient sobie tego nie życzy.
    captureDiagnostics: true,
  })
</script>`
}

/**
 * Wariant WordPress: mu-plugin z podstawianiem tożsamości.
 *
 * Robi trzy rzeczy, których zwykły snippet zrobić nie może:
 *
 * 1. Osadza widget WARUNKOWO, tylko gdy w adresie jest `?siteping`. Bez tego
 *    przycisk zgłaszania widzi każdy odwiedzający, co przy stronie firmowej
 *    jest otwartą drogą spamu prosto do ClickUpa.
 * 2. Wymienia `${SITEPING_TOKEN_PARAM}` na imię i mail PO STRONIE SERWERA.
 *    Gdyby robił to JavaScript, token krążyłby po froncie cudzej strony,
 *    gdzie może go odczytać dowolny inny skrypt (analityka, GTM, wtyczki).
 * 3. Dzięki temu widget nie pyta zgłaszającego o nic.
 */
export function buildWordPressSnippet({ slug, appUrl }: SnippetInput): string {
  const base = bezUkosnika(appUrl)
  return `<?php
/**
 * Plugin Name: SitePing (${slug})
 * Description: Widget zgłoszeń important.is. Wgraj do wp-content/mu-plugins/.
 */

add_action('wp_footer', function () {
    // Widget tylko na żądanie: bez tego przycisk zgłaszania widzi każdy
    // odwiedzający, a to otwarta droga spamu do ClickUpa.
    if (!isset($_GET['siteping'])) {
        return;
    }

    $identity = null;
    if (!empty($_GET['${SITEPING_TOKEN_PARAM}'])) {
        // Wymiana tokenu PO STRONIE SERWERA. Token nie może trafić do
        // JavaScriptu — odczytałby go każdy inny skrypt na tej stronie.
        $res = wp_remote_get(add_query_arg([
            'token' => sanitize_text_field(wp_unslash($_GET['${SITEPING_TOKEN_PARAM}'])),
            'slug'  => '${slug}',
        ], '${base}/api/siteping/identity'), ['timeout' => 5]);

        if (!is_wp_error($res) && wp_remote_retrieve_response_code($res) === 200) {
            $identity = json_decode(wp_remote_retrieve_body($res), true);
        }
    }

    $config = [
        'endpoint'           => '${base}/api/siteping/${slug}',
        'projectName'        => '${slug}',
        'enableScreenshot'   => true,
        // WYMAGANE. Bez tego link „Zobacz na stronie" z zadania w ClickUpie
        // otworzy stronę i niczego nie podświetli.
        'deepLink'           => true,
        // Zbiera konsolę i nieudane żądania z chwili zgłoszenia.
        // Usuń tę linię, jeśli klient sobie tego nie życzy.
        'captureDiagnostics' => true,
    ];
    if ($identity) {
        $config['identity'] = ['name' => $identity['name'], 'email' => $identity['email']];
        // Dowod tozsamosci dla trasy [slug]: token jest juz raz zweryfikowany
        // przez /api/siteping/identity, ktora go odeslala niezmienionego.
        // Bez tego zgloszenie jako admin@important.is (np. test Łukasza z
        // panelu) trafia w blokade podszywania sie — patrz store.ts.
        if (!empty($identity['token'])) {
            $config['headers'] = ['Authorization' => 'Bearer ' . $identity['token']];
        }
    }
    ?>
    <script src="${base}/siteping/widget.js"></script>
    <script>
      window.SitePing.initSiteping(<?php echo wp_json_encode($config); ?>);
    </script>
    <?php
});`
}
