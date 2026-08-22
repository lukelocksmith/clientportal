import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { parseAutoTags, serializeAutoTags, buildAiChatTags } from '@/lib/autoTags'

describe('autoTags', () => {
  it('parseAutoTags: null/pusty string dają pustą listę, reszta trimowana', () => {
    assert.deepEqual(parseAutoTags(null), [])
    assert.deepEqual(parseAutoTags(''), [])
    assert.deepEqual(parseAutoTags('asana, portal ,  '), ['asana', 'portal'])
  })

  it('serializeAutoTags: deduplikuje i pustą listę zamienia na null, nie na pusty string', () => {
    assert.equal(serializeAutoTags([]), null)
    assert.equal(serializeAutoTags(['asana', 'asana', 'portal']), 'asana,portal')
    assert.equal(serializeAutoTags(['  asana  ']), 'asana')
  })

  it('buildAiChatTags: łączy skonfigurowane tagi z tagiem awarii, bez duplikatów', () => {
    assert.equal(buildAiChatTags(null, false), undefined)
    assert.deepEqual(buildAiChatTags(null, true), ['awaria'])
    assert.deepEqual(buildAiChatTags('asana,portal', false), ['asana', 'portal'])
    assert.deepEqual(buildAiChatTags('asana,awaria', true), ['asana', 'awaria'])
  })
})
