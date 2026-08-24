import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  NOTIFY_EVENTS,
  parseNotificationConfig,
  serializeNotificationConfig,
  channelEnabled,
  notificationsOff,
} from './notifyConfig'

/**
 * Macierz powiadomien per projekt: zdarzenie x kanal, ustawiana przez admina.
 *
 * Dwie zasady, ktore te testy pilnuja mocniej niz reszte:
 *
 * 1. BRAK KONFIGURACJI ZNACZY CISZA. Portal bez ustawien nie wysyla nic. Maila
 *    wyslanego przez pomylke nie da sie cofnac, wiec kazda niepewnosc (null w
 *    bazie, smiec po recznej edycji, nieznane zdarzenie) konczy sie cisza.
 * 2. SMS NIE ISTNIEJE W ZAPISIE. W panelu kolumna jest widoczna i nieaktywna,
 *    ale konfiguracja go nie przyjmuje, bo producent go nie obsluguje. Inaczej
 *    admin zaznaczylby kratke, ktora nic nie robi, i nikt by sie nie dowiedzial.
 *
 *   npx vitest run src/lib/notifyConfig.test.ts
 */

describe('brak konfiguracji znaczy cisza', () => {
  it('null z bazy daje wszystko wylaczone', () => {
    const config = parseNotificationConfig(null)

    for (const event of NOTIFY_EVENTS) {
      assert.strictEqual(channelEnabled(config, event, 'bell'), false, `dzwonek dla ${event}`)
      assert.strictEqual(channelEnabled(config, event, 'mail'), false, `mail dla ${event}`)
    }
    assert.strictEqual(notificationsOff(config), true)
  })

  it('smiec w kolumnie tez daje cisze, nie wyjatek', () => {
    for (const smiec of ['nie-json', 42, [], { comment: 'tak' }, { comment: { mail: 'moze' } }]) {
      const config = parseNotificationConfig(smiec)
      assert.strictEqual(notificationsOff(config), true, `smiec: ${JSON.stringify(smiec)}`)
    }
  })

  it('nieznane zdarzenie w zapisie jest pomijane, znane zostaje', () => {
    const config = parseNotificationConfig({
      comment: { mail: true, bell: true },
      wymyslone: { mail: true, bell: true },
    })

    assert.strictEqual(channelEnabled(config, 'comment', 'mail'), true)
    assert.strictEqual(Object.keys(config).includes('wymyslone'), false)
  })
})

describe('odczyt macierzy', () => {
  const config = parseNotificationConfig({
    comment: { mail: true, bell: true },
    status: { mail: false, bell: true },
    closed: { mail: true, bell: false },
  })

  it('czyta kanal dla zdarzenia', () => {
    assert.strictEqual(channelEnabled(config, 'comment', 'mail'), true)
    assert.strictEqual(channelEnabled(config, 'status', 'mail'), false)
    assert.strictEqual(channelEnabled(config, 'status', 'bell'), true)
    assert.strictEqual(channelEnabled(config, 'closed', 'bell'), false)
  })

  it('zdarzenie nieobecne w zapisie jest wylaczone', () => {
    assert.strictEqual(channelEnabled(config, 'created', 'mail'), false)
    assert.strictEqual(channelEnabled(config, 'created', 'bell'), false)
  })

  it('cokolwiek wlaczone znaczy, ze powiadomienia dla projektu dzialaja', () => {
    assert.strictEqual(notificationsOff(config), false)
  })
})

describe('SMS nie wchodzi do zapisu', () => {
  it('kanal sms jest odrzucany, reszta zdarzenia zostaje', () => {
    const config = parseNotificationConfig({ comment: { mail: true, bell: true, sms: true } })

    assert.strictEqual(channelEnabled(config, 'comment', 'mail'), true)
    assert.strictEqual(JSON.stringify(config).includes('sms'), false)
  })
})

describe('zapis do bazy', () => {
  it('pusta macierz zapisuje sie jako null, nie jako pusty obiekt', () => {
    // `null` znaczy „nigdy nie ustawione" i „wylaczone" jednocześnie, i to jest
    // w porzadku: oba znaczą ciszę. Pusty obiekt byłby trzecim stanem bez sensu.
    assert.strictEqual(serializeNotificationConfig(parseNotificationConfig(null)), null)
  })

  it('to, co zapisane, wraca po odczycie takie samo', () => {
    const wejscie = { comment: { mail: true, bell: true }, closed: { mail: false, bell: true } }
    const tam = serializeNotificationConfig(parseNotificationConfig(wejscie))
    const nazad = parseNotificationConfig(tam)

    assert.strictEqual(channelEnabled(nazad, 'comment', 'mail'), true)
    assert.strictEqual(channelEnabled(nazad, 'closed', 'bell'), true)
    assert.strictEqual(channelEnabled(nazad, 'closed', 'mail'), false)
  })

  it('kratki odznaczone nie zasmiecaja zapisu', () => {
    const zapis = serializeNotificationConfig(
      parseNotificationConfig({ comment: { mail: true, bell: false }, status: { mail: false, bell: false } })
    )

    assert.strictEqual(JSON.stringify(zapis).includes('status'), false, 'zdarzenie bez zadnego kanalu wypada')
  })
})
