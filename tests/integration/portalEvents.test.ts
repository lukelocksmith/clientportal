/**
 * Historia zgloszen na PRAWDZIWEJ bazie.
 *
 * Te przypadki sa nie do sprawdzenia testem jednostkowym, bo zale=za od typow
 * kolumn i regul kluczy obcych w Postgresie. Oba bledy, ktore ten plik pilnuje,
 * przeszly przez `tsc` bez slowa:
 *
 *   1. 'admin' wstawiane do kolumny uuid — blad bazy zjadany przez try/catch.
 *   2. Klucz obcy bez ON DELETE — usuniecie uzytkownika wywala sie na naruszeniu
 *      klucza, czyli admin nie moze usunac konta osoby, ktora cokolwiek zglosila.
 *
 *   npm run test:integration
 */
import { describe, it, afterAll } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portalUsers, auditLog } from '@/lib/db/schema'
import {
  logEvent,
  listPortalEvents,
  portalEventActors,
  attachResourceId,
  getTaskReporter,
  EVENT_TASK_CREATED,
  EVENT_PANIC_ALERT,
  EVENT_COMMENT_ADDED,
  EVENT_LOGIN,
  EVENT_LOGIN_FAILED,
  EVENT_LABELS,
  requestOrigin,
} from '@/lib/portalEvents'
import { createTestPortal, dropTestPortal, createTestUser, isDbReachable } from './helpers'

// Sprawdzane RAZ, na poziomie modulu. Wczesniej kazdy test robil `if
// (!reachable) return`, czyli przy niedostepnej bazie caly plik przechodzil na
// zielono, nie testujac niczego. Zielono, ktore nic nie znaczy, jest gorsze niz
// brak testu, wiec teraz pomijanie jest widoczne jako pomijanie.
const reachable = await isDbReachable()
const portalsToDrop: string[] = []

afterAll(async () => {
  for (const id of portalsToDrop) await dropTestPortal(id)
})

async function freshPortal(prefix: string) {
  const portal = await createTestPortal(prefix)
  portalsToDrop.push(portal.id)
  return portal
}

/**
 * `requestOrigin` jest czyste, ale mieszka w tym samym module co zapytania,
 * wiec import wciaga sterownik bazy. Stad ten przypadek jest tutaj, a nie w
 * tescie jednostkowym: inaczej trzeba by dzielic plik tylko dla jednej funkcji.
 */
describe.skipIf(!reachable)('historia jednej osoby', () => {
  it('zdarzenia jednej osoby nie mieszaja sie z druga w tym samym projekcie', async () => {
    const portal = await freshPortal('hist-dwie')
    const anna = await createTestUser(portal.id, 'anna@klient.test')
    const bartek = await createTestUser(portal.id, 'bartek@klient.test')

    await logEvent({
      portalId: portal.id,
      actor: { userId: anna, email: 'anna@klient.test', name: 'Anna' },
      action: EVENT_LOGIN,
      meta: { ip: '203.0.113.9', wejscie: 'projekt' },
    })
    await logEvent({
      portalId: portal.id,
      actor: { userId: anna, email: 'anna@klient.test', name: 'Anna' },
      action: EVENT_TASK_CREATED,
      meta: { taskName: 'Zadanie Anny' },
    })
    await logEvent({
      portalId: portal.id,
      actor: { userId: bartek, email: 'bartek@klient.test', name: 'Bartek' },
      action: EVENT_LOGIN_FAILED,
      meta: { powod: 'zle haslo' },
    })

    const historiaAnny = await listPortalEvents({
      portalId: portal.id,
      userEmail: 'anna@klient.test',
    })
    assert.strictEqual(historiaAnny.length, 2)
    assert.ok(
      historiaAnny.every(e => e.userEmail === 'anna@klient.test'),
      'w historii Anny jest zdarzenie kogos innego'
    )
    // Kolejnosc od najnowszych: okno pokazuje ostatnie wejscie na gorze.
    assert.strictEqual(historiaAnny[0].action, EVENT_TASK_CREATED)
  })

  it('ten sam adres w dwoch projektach ma dwie osobne historie', async () => {
    // Realny przypadek: jedna osoba u klienta prowadzi dwa nasze projekty.
    // Bez warunku na projekt zobaczylaby w obu oknach te sama liste.
    const a = await freshPortal('hist-proj-a')
    const b = await freshPortal('hist-proj-b')
    const email = 'wspolny@klient.test'
    const wA = await createTestUser(a.id, email)
    const wB = await createTestUser(b.id, email)

    await logEvent({
      portalId: a.id,
      actor: { userId: wA, email, name: null },
      action: EVENT_LOGIN,
      meta: { wejscie: 'projekt' },
    })
    await logEvent({
      portalId: b.id,
      actor: { userId: wB, email, name: null },
      action: EVENT_PANIC_ALERT,
      meta: null,
    })

    const wProjekcieA = await listPortalEvents({ portalId: a.id, userEmail: email })
    const wProjekcieB = await listPortalEvents({ portalId: b.id, userEmail: email })

    assert.deepStrictEqual(wProjekcieA.map(e => e.action), [EVENT_LOGIN])
    assert.deepStrictEqual(wProjekcieB.map(e => e.action), [EVENT_PANIC_ALERT])
  })

  it('historia zostaje po usunieciu konta, bo idzie po adresie', async () => {
    // To jest cala przyczyna, dla ktorej filtrujemy po adresie, a nie po
    // user_id. Konto mozna usunac, a pytanie "kto to zamawial" nie znika.
    const portal = await freshPortal('hist-usun')
    const userId = await createTestUser(portal.id, 'odchodzi@klient.test')

    await logEvent({
      portalId: portal.id,
      actor: { userId, email: 'odchodzi@klient.test', name: 'Odchodzi' },
      action: EVENT_TASK_CREATED,
      meta: { taskName: 'Zadanie sprzed odejscia' },
    })

    await db.delete(portalUsers).where(eq(portalUsers.id, userId))

    const po = await listPortalEvents({ portalId: portal.id, userEmail: 'odchodzi@klient.test' })
    assert.strictEqual(po.length, 1, 'historia zniknela razem z kontem')
    assert.strictEqual(po[0].userName, 'Odchodzi', 'zgubione imie zglaszajacego')
  })

  it('kazde zdarzenie ma nazwe do pokazania, zadne nie wyswietli slugu', async () => {
    // Bez tego dodanie nowego rodzaju zdarzenia bez wpisu w EVENT_LABELS
    // pokazuje adminowi "login_failed" zamiast "Nieudane logowanie".
    const portal = await freshPortal('hist-nazwy')
    const userId = await createTestUser(portal.id, 'nazwy@klient.test')

    for (const action of Object.keys(EVENT_LABELS)) {
      await logEvent({
        portalId: portal.id,
        actor: { userId, email: 'nazwy@klient.test', name: null },
        action: action as Parameters<typeof logEvent>[0]['action'],
        meta: null,
      })
    }

    const wszystkie = await listPortalEvents({ portalId: portal.id, userEmail: 'nazwy@klient.test' })
    assert.strictEqual(wszystkie.length, Object.keys(EVENT_LABELS).length)
    for (const e of wszystkie) {
      assert.notStrictEqual(e.actionLabel, e.action, `brak nazwy dla zdarzenia ${e.action}`)
      assert.ok(/^[A-ZĄĆĘŁŃÓŚŹŻ]/.test(e.actionLabel), `nazwa nie jest po polsku: ${e.actionLabel}`)
    }
  })
})

describe('requestOrigin', () => {
  it('bierze PIERWSZY adres z x-forwarded-for', () => {
    // Ostatni adres to nasze wlasne proxy: mialby te sama wartosc dla kazdego
    // uzytkownika, czyli zadnej wartosci diagnostycznej.
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 172.16.0.5', 'user-agent': 'Chrome' })
    assert.deepStrictEqual(requestOrigin(h), { ip: '203.0.113.9', userAgent: 'Chrome' })
  })

  it('brak naglowkow to null, nie pusty ciag', () => {
    // Pusty ciag wyswietlilby sie w panelu jako " \u00b7 " bez tresci, a null
    // pozwala pominac ten fragment wiersza.
    assert.deepStrictEqual(requestOrigin(new Headers()), { ip: null, userAgent: null })
    assert.deepStrictEqual(requestOrigin(new Headers({ 'x-forwarded-for': '   ' })), { ip: null, userAgent: null })
  })
})

describe.skipIf(!reachable)('portalEvents', () => {
  it("sesja admina zapisuje sie z userId = null, nie wybucha na uuid", async () => {
    const portal = await freshPortal('ev-admin')

    const id = await logEvent({
      portalId: portal.id,
      // Dokladnie to, co zwraca lib/auth.ts dla obejscia admina.
      actor: { userId: 'admin', email: 'admin@important.is', name: 'Admin' },
      action: EVENT_TASK_CREATED,
      resourceId: 'abc123',
      meta: { taskName: 'Zadanie testowe' },
    })

    assert.ok(id, 'zapis zdarzenia dla admina zwrocil null, czyli poleciał wyjatkiem')

    const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id!))
    assert.strictEqual(row.userId, null, "'admin' nie jest uuid, wiec kolumna musi byc pusta")
    assert.strictEqual(row.userEmail, 'admin@important.is', 'adres musi zostac, inaczej nie wiadomo kto to byl')
  })

  it('historia przezywa usuniecie konta uzytkownika', async () => {
    const portal = await freshPortal('ev-del')
    const userId = await createTestUser(portal.id, 'anna@test.pl')

    await logEvent({
      portalId: portal.id,
      actor: { userId, email: 'anna@test.pl', name: 'Anna' },
      action: EVENT_TASK_CREATED,
      resourceId: 'task-1',
      meta: { taskName: 'Poprawka formularza' },
    })

    // Przed migracja 0013 klucz obcy nie mial ON DELETE, wiec TA LINIA rzucala
    // bledem naruszenia klucza: admin nie mogl usunac konta osoby, ktora
    // cokolwiek zglosila.
    await db.delete(portalUsers).where(eq(portalUsers.id, userId))

    const events = await listPortalEvents({ portalId: portal.id })
    assert.strictEqual(events.length, 1, 'zdarzenie zniknelo razem z kontem')
    assert.strictEqual(events[0].userEmail, 'anna@test.pl', 'po usunieciu konta zostal wiersz bez autora')
    assert.strictEqual(events[0].userName, 'Anna')
    assert.deepStrictEqual(events[0].meta, { taskName: 'Poprawka formularza' })
  })

  it('lista jest od najnowszych, z etykietami i filtrem po rodzaju', async () => {
    const portal = await freshPortal('ev-sort')
    const userId = await createTestUser(portal.id, 'bob@test.pl')
    const actor = { userId, email: 'bob@test.pl', name: 'Bob' }

    await logEvent({ portalId: portal.id, actor, action: EVENT_TASK_CREATED, resourceId: 't1' })
    await logEvent({ portalId: portal.id, actor, action: EVENT_COMMENT_ADDED, resourceId: 't1' })
    await logEvent({ portalId: portal.id, actor, action: EVENT_PANIC_ALERT, resourceId: 'a1' })

    const all = await listPortalEvents({ portalId: portal.id })
    assert.strictEqual(all.length, 3)
    assert.strictEqual(all[0].action, EVENT_PANIC_ALERT, 'najnowsze musi byc pierwsze')
    assert.strictEqual(all[0].actionLabel, 'Alarm', 'etykieta po polsku, nie surowy klucz')

    const tylkoAlarmy = await listPortalEvents({ portalId: portal.id, action: EVENT_PANIC_ALERT })
    assert.strictEqual(tylkoAlarmy.length, 1)
    assert.strictEqual(tylkoAlarmy[0].resourceId, 'a1')
  })

  it('zdarzenia jednego klienta nie wyciekaja do drugiego', async () => {
    const a = await freshPortal('ev-a')
    const b = await freshPortal('ev-b')
    const userA = await createTestUser(a.id, 'a@test.pl')

    await logEvent({
      portalId: a.id,
      actor: { userId: userA, email: 'a@test.pl', name: 'A' },
      action: EVENT_TASK_CREATED,
      meta: { taskName: 'TAJNE ZADANIE KLIENTA A' },
    })

    const events = await listPortalEvents({ portalId: b.id })
    assert.strictEqual(events.length, 0, 'zdarzenie klienta A widoczne w projekcie B')

    const actors = await portalEventActors(b.id)
    assert.strictEqual(actors.length, 0, 'osoba klienta A widoczna na liscie osob klienta B')
  })

  it('lista osob liczy zdarzenia i pomija wiersze bez adresu', async () => {
    const portal = await freshPortal('ev-actors')
    const anna = await createTestUser(portal.id, 'anna@test.pl')
    const bob = await createTestUser(portal.id, 'bob@test.pl')

    await logEvent({ portalId: portal.id, actor: { userId: anna, email: 'anna@test.pl', name: 'Anna' }, action: EVENT_TASK_CREATED })
    await logEvent({ portalId: portal.id, actor: { userId: anna, email: 'anna@test.pl', name: 'Anna' }, action: EVENT_COMMENT_ADDED })
    await logEvent({ portalId: portal.id, actor: { userId: bob, email: 'bob@test.pl', name: 'Bob' }, action: EVENT_PANIC_ALERT })
    // Wiersz bez adresu: taki nie ma jak trafic do filtra po osobie.
    await logEvent({ portalId: portal.id, actor: { userId: null, email: null, name: null }, action: EVENT_TASK_CREATED })

    const actors = await portalEventActors(portal.id)
    assert.strictEqual(actors.length, 2, 'wiersz bez adresu nie moze tworzyc osoby-widma')

    const byEmail = Object.fromEntries(actors.map(a => [a.email, a]))
    assert.strictEqual(byEmail['anna@test.pl'].count, 2)
    assert.strictEqual(byEmail['bob@test.pl'].count, 1)
    assert.strictEqual(byEmail['anna@test.pl'].name, 'Anna')

    // Licznik przy nazwisku musi zgadzac sie z liczba wierszy po kliknieciu w
    // te osobe, inaczej filtr klamie.
    const annaEvents = await listPortalEvents({ portalId: portal.id, userEmail: 'anna@test.pl' })
    assert.strictEqual(annaEvents.length, byEmail['anna@test.pl'].count, 'licznik przy osobie nie zgadza sie z lista')
  })

  it('zapis zdarzenia NIE przewraca dzialania, gdy dane sa bledne', async () => {
    // Zadanie w ClickUpie w tym momencie juz istnieje. Wyjatek z logu
    // pokazalby klientowi blad, a on kliknalby drugi raz i zglosil to samo dwa
    // razy. Zgubiony wiersz historii jest tansszy niz zdublowane zadanie.
    const id = await logEvent({
      portalId: '00000000-0000-0000-0000-000000000000', // portal nie istnieje
      actor: { userId: null, email: 'x@test.pl', name: null },
      action: EVENT_TASK_CREATED,
    })
    assert.strictEqual(id, null, 'blad zapisu ma zwrocic null, nie rzucic')
  })

  it('resourceId da sie dopisac po fakcie, a null nie wybucha', async () => {
    const portal = await freshPortal('ev-attach')
    const id = await logEvent({
      portalId: portal.id,
      actor: { userId: null, email: 'x@test.pl', name: null },
      action: EVENT_TASK_CREATED,
    })

    await attachResourceId(id, 'clickup-999')
    const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id!))
    assert.strictEqual(row.resourceId, 'clickup-999')

    // Zapis zdarzenia mogl sie nie udac (zwraca null). Dopisanie do niczego
    // musi byc wtedy operacja pusta, nie bledem.
    await attachResourceId(null, 'clickup-000')
  })

  it('zglaszajacy pokazywany klientowi: osoba, my, albo my przy braku wpisu', async () => {
    const portal = await freshPortal('ev-rep')
    const userId = await createTestUser(portal.id, 'anna@test.pl')

    // 1. Zgloszenie klienta: klient widzi swoja osobe.
    await logEvent({
      portalId: portal.id,
      actor: { userId, email: 'anna@test.pl', name: 'Anna' },
      action: EVENT_TASK_CREATED,
      resourceId: 'zad-klienta',
    })
    const klient = await getTaskReporter(portal.id, 'zad-klienta')
    assert.strictEqual(klient?.name, 'Anna')
    assert.strictEqual(klient?.isAgency, false)

    // 2. Zadanie zalozone w trybie admina: podpisujemy sie MY, nie klient.
    // Podpisanie tego klientem falszowalo by historie wspolpracy.
    await logEvent({
      portalId: portal.id,
      actor: { userId: 'admin', email: 'admin@important.is', name: 'Admin' },
      action: EVENT_TASK_CREATED,
      resourceId: 'zad-admina',
    })
    const admin = await getTaskReporter(portal.id, 'zad-admina')
    assert.strictEqual(admin?.isAgency, true, 'sesja admina to my, nie klient')
    assert.strictEqual(admin?.name, null, 'imie admina nie ma wychodzic do klienta')
    assert.strictEqual(admin?.email, null, 'adres obejsciowy nie ma wychodzic do klienta')

    // 3. Zadanie sprzed tej historii albo zalozone przez nas wprost w ClickUpie.
    // Null to stan NORMALNY, wolajacy pokazuje wtedy "Important.is".
    assert.strictEqual(await getTaskReporter(portal.id, 'zad-nieznane'), null)

    // 4. Komentarz do zadania NIE czyni z nikogo zglaszajacego.
    await logEvent({
      portalId: portal.id,
      actor: { userId, email: 'anna@test.pl', name: 'Anna' },
      action: EVENT_COMMENT_ADDED,
      resourceId: 'zad-tylko-komentarz',
    })
    assert.strictEqual(
      await getTaskReporter(portal.id, 'zad-tylko-komentarz'),
      null,
      'autor komentarza nie jest autorem zgloszenia'
    )
  })

  it('zglaszajacy nie przecieka miedzy projektami', async () => {
    const a = await freshPortal('rep-a')
    const b = await freshPortal('rep-b')
    const userA = await createTestUser(a.id, 'a@test.pl')

    // To samo id zadania odpytane z DRUGIEGO projektu. Bez warunku na portalId
    // klient B zobaczylby imie pracownika klienta A.
    await logEvent({
      portalId: a.id,
      actor: { userId: userA, email: 'a@test.pl', name: 'Pracownik A' },
      action: EVENT_TASK_CREATED,
      resourceId: 'wspolne-id',
    })

    assert.strictEqual((await getTaskReporter(a.id, 'wspolne-id'))?.name, 'Pracownik A')
    assert.strictEqual(await getTaskReporter(b.id, 'wspolne-id'), null, 'WYCIEK autora miedzy klientami')
  })

  it('uszkodzone meta nie przewracaja listy', async () => {
    const portal = await freshPortal('ev-meta')
    // Wiersz sprzed wprowadzenia JSON-a w tej kolumnie albo ucięty zapis.
    await db.insert(auditLog).values({
      portalId: portal.id,
      userEmail: 'x@test.pl',
      action: EVENT_TASK_CREATED,
      meta: 'to nie jest JSON',
    })

    const events = await listPortalEvents({ portalId: portal.id })
    assert.strictEqual(events.length, 1, 'lista przewrocila sie na uszkodzonych metadanych')
    assert.strictEqual(events[0].meta, null)
    assert.strictEqual(events[0].userEmail, 'x@test.pl', 'kto/co/kiedy jest w kolumnach, wiec musi przezyc')
  })
})
