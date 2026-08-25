import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  normalizeName,
  validatePasswordChange,
  parseAvatarDataUri,
  cropSquare,
  avatarInitials,
  MAX_AVATAR_BYTES,
  MIN_PASSWORD_LENGTH,
} from './profile'

/**
 * Profil uzytkownika: imie, haslo, zdjecie.
 *
 * Czysta logika strony profilu. Jest tu, a nie w trasach, bo te same reguly
 * obowiazuja po OBU stronach: przegladarka blokuje przycisk, a serwer i tak
 * sprawdza wszystko drugi raz. Rozjazd miedzy tymi dwoma miejscami konczy sie
 * albo formularzem, ktorego nie da sie wyslac, albo trasa przyjmujaca to,
 * czego formularz nie wypuszcza.
 *
 *   npx vitest run src/lib/profile.test.ts
 */

describe('normalizeName', () => {
  it('obcina biale znaki z brzegow', () => {
    assert.strictEqual(normalizeName('  Filip  '), 'Filip')
  })

  it('PUSTE imie to null, nie pusty napis', () => {
    // W bazie `name` jest nullowalne i null znaczy „nie podano". Pusty napis
    // znaczylby to samo, ale przechodzilby przez `name ?? 'ktos'` jako wartosc,
    // wiec w stopce zadania w ClickUpie zostawialby dziure zamiast adresu.
    assert.strictEqual(normalizeName(''), null)
    assert.strictEqual(normalizeName('   '), null)
    assert.strictEqual(normalizeName(null), null)
    assert.strictEqual(normalizeName(undefined), null)
    assert.strictEqual(normalizeName(42), null)
  })

  it('ZBIJA znaki nowej linii i tabulatory do pojedynczej spacji', () => {
    // Imie trafia do stopki zadania w ClickUpie („Zgloszone przez: X <mail>"),
    // do tematu maila i do podpisu komentarza. Znak nowej linii w imieniu
    // rozbija tam kazda z tych jednolinijkowych konstrukcji, a wklejenie
    // imienia z innego pola jest najzwyklejsza rzecza pod sloncem.
    assert.strictEqual(normalizeName('Anna\nKowalska'), 'Anna Kowalska')
    assert.strictEqual(normalizeName('Anna\t\tKowalska'), 'Anna Kowalska')
    assert.strictEqual(normalizeName('Anna   Kowalska'), 'Anna Kowalska')
  })

  it('wyrzuca znaki sterujace, zostawiajac reszte imienia', () => {
    assert.strictEqual(normalizeName('Ar\u0007tem'), 'Artem')
  })

  it('NIE rusza polskich znakow', () => {
    assert.strictEqual(normalizeName('Łukasz Ślusarski'), 'Łukasz Ślusarski')
  })
})

describe('validatePasswordChange', () => {
  const dobre = { current: 'stare-haslo-1', next: 'nowe-haslo-1234', confirm: 'nowe-haslo-1234' }

  it('przepuszcza poprawny komplet', () => {
    assert.deepStrictEqual(validatePasswordChange(dobre), { ok: true })
  })

  it('WYMAGA obecnego hasla', () => {
    // To jest cala istota tej strony: przejeta sesja nie moze przejac konta.
    // Bez tego pola ktos, kto siadl przy niezablokowanym laptopie, zmienia
    // haslo i wlasciciel traci dostep, nie tracac nawet sesji.
    const wynik = validatePasswordChange({ ...dobre, current: '' })
    assert.strictEqual(wynik.ok, false)
    assert.match(wynik.ok === false ? wynik.error : '', /obecne hasło/i)
  })

  it('odrzuca haslo krotsze niz minimum', () => {
    const krotkie = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    const wynik = validatePasswordChange({ ...dobre, next: krotkie, confirm: krotkie })
    assert.strictEqual(wynik.ok, false)
    assert.match(wynik.ok === false ? wynik.error : '', new RegExp(String(MIN_PASSWORD_LENGTH)))
  })

  it('minimum jest TO SAMO co przy hasle z zaproszenia', () => {
    // Trasa /api/auth/set-password wymaga 10 znakow. Gdyby profil wymagal
    // mniej, klient ustawilby przez profil haslo, ktorego przy odzyskiwaniu
    // nie da sie powtorzyc, i uznalby, ze formularz jest zepsuty.
    assert.strictEqual(MIN_PASSWORD_LENGTH, 10)
  })

  it('odrzuca niezgodne powtorzenie', () => {
    const wynik = validatePasswordChange({ ...dobre, confirm: 'cos-zupelnie-innego' })
    assert.strictEqual(wynik.ok, false)
    assert.match(wynik.ok === false ? wynik.error : '', /takie same/i)
  })

  it('odrzuca nowe haslo IDENTYCZNE ze starym', () => {
    // Zmiana hasla po incydencie („ktos zna moje haslo") ma sens tylko wtedy,
    // gdy haslo faktycznie sie zmienia. Formularz, ktory przyjmuje to samo
    // haslo i mowi „gotowe", zostawia klienta w falszywym poczuciu, ze sprawa
    // zalatwiona.
    const wynik = validatePasswordChange({ current: 'to-samo-haslo', next: 'to-samo-haslo', confirm: 'to-samo-haslo' })
    assert.strictEqual(wynik.ok, false)
    assert.match(wynik.ok === false ? wynik.error : '', /różnić/i)
  })

  it('brak pola nie wywraca sprawdzenia', () => {
    // Cialo zadania pochodzi z sieci, wiec moze nie miec pol wcale.
    const wynik = validatePasswordChange({ current: undefined, next: undefined, confirm: undefined } as never)
    assert.strictEqual(wynik.ok, false)
  })
})

describe('parseAvatarDataUri', () => {
  /** Poprawny data URI o zadanej dlugosci ladunku. */
  const uri = (mime: string, dlugosc = 8) => `data:${mime};base64,${'A'.repeat(dlugosc)}`

  it('przepuszcza WebP, ktore produkuje przegladarka', () => {
    const wynik = parseAvatarDataUri(uri('image/webp'))
    assert.strictEqual(wynik?.contentType, 'image/webp')
    assert.strictEqual(wynik?.base64, 'A'.repeat(8))
  })

  it('przepuszcza JPEG, bo nie kazda przegladarka umie zapisac WebP', () => {
    // Canvas w starszym Safari po cichu oddaje inny format, gdy poprosic go
    // o WebP. Serwer przyjmujacy wylacznie WebP odrzucalby wtedy poprawnie
    // przeskalowane zdjecie, a uzytkownik widzialby „nieobslugiwany format"
    // bez zadnego sposobu, zeby cos z tym zrobic.
    assert.strictEqual(parseAvatarDataUri(uri('image/jpeg'))?.contentType, 'image/jpeg')
    assert.strictEqual(parseAvatarDataUri(uri('image/png'))?.contentType, 'image/png')
  })

  it('ODRZUCA SVG', () => {
    // SVG to dokument, ktory moze niesc skrypt, a trasa /api/avatar serwuje go
    // z NASZEGO origin. Reszta portalu (logo klienta) dopuszcza SVG, bo tam
    // adres podaje administrator; tu plik podaje uzytkownik.
    assert.strictEqual(parseAvatarDataUri(uri('image/svg+xml')), null)
  })

  it('odrzuca smiec zamiast obrazka', () => {
    for (const smiec of [
      '',
      'https://example.com/foto.webp',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/webp,niezakodowane',
      'data:image/webp;base64,',
      'data:image/webp;base64,to nie jest base64!',
      null,
      undefined,
      123,
      {},
    ]) {
      assert.strictEqual(parseAvatarDataUri(smiec), null, `nie powinno przejsc: ${JSON.stringify(smiec)}`)
    }
  })

  it('ODRZUCA ladunek ponad limit', () => {
    // Skalowanie robi przegladarka, ale przegladarka NIE JEST granica
    // bezpieczenstwa: to samo zadanie da sie wyslac curl-em. Bez tego limitu
    // kolumna `avatar_url` przyjmuje kilkumegabajtowe zdjecie z aparatu.
    assert.strictEqual(parseAvatarDataUri(uri('image/webp', MAX_AVATAR_BYTES + 4)), null)
  })

  it('przepuszcza ladunek tuz pod limitem', () => {
    // Para do testu wyzej: odmowa z powodu awarii wyglada jak odmowa z powodu
    // reguly, wiec limit musi tez czegos NIE odrzucac.
    const przedrostek = 'data:image/webp;base64,'
    // Base64 idzie czworkami znakow, wiec dlugosc musi byc podzielna przez 4.
    const dlugosc = Math.floor((MAX_AVATAR_BYTES - przedrostek.length) / 4) * 4
    assert.ok(parseAvatarDataUri(`${przedrostek}${'A'.repeat(dlugosc)}`))
  })
})

describe('cropSquare', () => {
  it('szerokie zdjecie tnie po bokach, symetrycznie', () => {
    assert.deepStrictEqual(cropSquare(400, 200), { sx: 100, sy: 0, size: 200 })
  })

  it('wysokie zdjecie tnie gora i dol', () => {
    assert.deepStrictEqual(cropSquare(200, 400), { sx: 0, sy: 100, size: 200 })
  })

  it('kwadrat zostaje nietkniety', () => {
    assert.deepStrictEqual(cropSquare(300, 300), { sx: 0, sy: 0, size: 300 })
  })

  it('nieparzysta roznica nie daje ulamkowego wyciecia', () => {
    // Ulamkowe wspolrzedne w `drawImage` daja rozmyty obrazek, a przy awatarze
    // 256 px widac to od razu.
    const wynik = cropSquare(101, 100)
    assert.strictEqual(Number.isInteger(wynik.sx), true)
    assert.strictEqual(Number.isInteger(wynik.sy), true)
    assert.strictEqual(wynik.size, 100)
  })
})

describe('avatarInitials', () => {
  it('bierze pierwsze litery imienia i nazwiska', () => {
    assert.strictEqual(avatarInitials('Anna Kowalska', 'anna@example.com'), 'AK')
  })

  it('samo imie daje jedna litere', () => {
    assert.strictEqual(avatarInitials('Filip', 'filip@example.com'), 'F')
  })

  it('BEZ imienia schodzi na adres, zamiast pokazywac puste kolo', () => {
    // Konta zaklada admin i imie bywa puste. Puste kolko w naglowku wyglada
    // na niedokonczony portal, a nie na brak jednego pola.
    assert.strictEqual(avatarInitials(null, 'klient@onyx.pl'), 'K')
  })

  it('nigdy nie zwraca pustego napisu', () => {
    assert.strictEqual(avatarInitials(null, ''), '?')
    assert.strictEqual(avatarInitials('   ', ''), '?')
  })
})
