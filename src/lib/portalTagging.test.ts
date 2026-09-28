import { describe, it } from 'vitest'
import assert from 'node:assert'
import { planPortalTagging, type TaggingTask } from '@/lib/portalTagging'

const t = (id: string, parent: string | null = null, tags: string[] = []): TaggingTask => ({
  id,
  name: id,
  parent,
  tags: tags.map(name => ({ name })),
})

describe('planPortalTagging', () => {
  const zbior = [
    t('zgl'),
    t('zgl-krok', 'zgl'),
    t('juz-ma', null, ['portal']),
    t('869eprajy'),
    t('869eprajy-sub', '869eprajy'),
    t('milestone'),
    t('wycena', 'milestone'),
    t('sierota', 'rodzic-spoza-zakresu'),
  ]

  it('taguje tylko korzenie bez tagu, z pominięciem wykluczonych', () => {
    const plan = planPortalTagging(zbior, new Set(['869eprajy']))
    assert.deepStrictEqual(plan.toTag.map(x => x.id).sort(), ['milestone', 'sierota', 'zgl'])
    assert.deepStrictEqual(plan.alreadyTagged.map(x => x.id), ['juz-ma'])
    assert.deepStrictEqual(plan.excluded.map(x => x.id), ['869eprajy'])
  })

  it('liczy, ile klient zobaczy przed i po', () => {
    const plan = planPortalTagging(zbior, new Set(['869eprajy']))
    assert.strictEqual(plan.visibleToday, 8)
    // Znika notatka i jej podzadanie.
    assert.strictEqual(plan.visibleAfter, 6)
    assert.deepStrictEqual(plan.conflicts, [])
  })

  it('wykluczone PODZADANIE pod tagowanym rodzicem to konflikt, nie ukrycie', () => {
    const plan = planPortalTagging(zbior, new Set(['wycena']))
    assert.deepStrictEqual(plan.conflicts.map(c => [c.task.id, c.visibleVia]), [['wycena', 'milestone']])
  })

  it('wykluczenie rodzica ukrywa też podzadanie, bez konfliktu', () => {
    const plan = planPortalTagging(zbior, new Set(['milestone', 'wycena']))
    assert.deepStrictEqual(plan.conflicts, [])
    assert.strictEqual(plan.toTag.some(x => x.id === 'milestone'), false)
  })

  it('wykluczony korzeń, który JUŻ ma tag, zostaje zgłoszony jako konflikt', () => {
    const plan = planPortalTagging(zbior, new Set(['juz-ma']))
    assert.deepStrictEqual(plan.conflicts.map(c => c.task.id), ['juz-ma'])
  })

  it('wykluczenie spoza zbioru jest wypisane, a nie przemilczane', () => {
    const plan = planPortalTagging(zbior, new Set(['literowka']))
    assert.deepStrictEqual(plan.unknownExclusions, ['literowka'])
  })
})
