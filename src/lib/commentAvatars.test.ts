/**
 * Dopasowanie autora komentarza do konta ze zdjęciem.
 *
 *   npx vitest run src/lib/commentAvatars.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { buildAvatarIndex, avatarUserIdForSender, type AvatarOwner } from '@/lib/commentAvatars'

const konta: AvatarOwner[] = [
  { id: 'u-lukasz', name: 'Łukasz Ślusarski' },
  { id: 'u-ania', name: 'Anna Kowalska' },
]

describe('dopasowanie po nazwie', () => {
  it('pelna nazwa trafia w konto', () => {
    const i = buildAvatarIndex(konta)
    assert.strictEqual(avatarUserIdForSender(i, 'Łukasz Ślusarski'), 'u-lukasz')
  })

  it('rozna wielkosc liter i podwojne spacje nie psuja trafienia', () => {
    // Nazwa idzie przez tresc komentarza w ClickUpie, gdzie o druga spacje
    // albo inna wielkosc litery jest banalnie latwo.
    const i = buildAvatarIndex(konta)
    assert.strictEqual(avatarUserIdForSender(i, '  łukasz   ŚLUSARSKI '), 'u-lukasz')
  })

  it('samo imie trafia, gdy jest jednoznaczne', () => {
    const i = buildAvatarIndex(konta)
    assert.strictEqual(avatarUserIdForSender(i, 'Łukasz'), 'u-lukasz')
  })

  it('powtorzone imie NIE dostaje zdjecia', () => {
    // Lepiej inicjaly niz cudza twarz przy czyims komentarzu.
    const i = buildAvatarIndex([...konta, { id: 'u-lukasz-2', name: 'Łukasz Nowak' }])
    assert.strictEqual(avatarUserIdForSender(i, 'Łukasz'), null)
    // Pelne nazwy nadal dzialaja, bo sa rozne.
    assert.strictEqual(avatarUserIdForSender(i, 'Łukasz Nowak'), 'u-lukasz-2')
    assert.strictEqual(avatarUserIdForSender(i, 'Łukasz Ślusarski'), 'u-lukasz')
  })

  it('dwa konta o IDENTYCZNEJ nazwie wylaczaja zdjecie dla obu', () => {
    const i = buildAvatarIndex([...konta, { id: 'u-inny', name: 'Łukasz Ślusarski' }])
    assert.strictEqual(avatarUserIdForSender(i, 'Łukasz Ślusarski'), null)
  })

  it('nieznany autor, agencja, brak podpisu: null, bez wywalenia', () => {
    const i = buildAvatarIndex(konta)
    assert.strictEqual(avatarUserIdForSender(i, 'important.is'), null)
    assert.strictEqual(avatarUserIdForSender(i, 'Ktos Obcy'), null)
    assert.strictEqual(avatarUserIdForSender(i, null), null)
    assert.strictEqual(avatarUserIdForSender(i, ''), null)
  })

  it('konto bez nazwy nie wchodzi do mapy', () => {
    const i = buildAvatarIndex([{ id: 'u-bez', name: null }, { id: 'u-pusty', name: '   ' }])
    assert.strictEqual(i.size, 0)
  })
})
