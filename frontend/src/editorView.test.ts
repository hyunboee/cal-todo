import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { PreviewBlock } from './api/types.ts'
import { EDIT_TEXT_MAX, blockLabel, copyText, pickBlock } from './editorView.ts'

const blk = (blockId: string, ...texts: string[]): PreviewBlock =>
  ({ blockId, fields: texts.map((text, i) => ({ editId: `${blockId}e${i}`, text })) })

const blocks = [blk('b1', '하나'), blk('b2', '둘'), blk('b3', '셋')]

describe('상수(백엔드 config.js와 같은 값)', () => {
  it('EDIT_TEXT_MAX 2000', () => assert.equal(EDIT_TEXT_MAX, 2000))
})

describe('pickBlock', () => {
  it('selectedId 일치 → 그 블록', () => assert.equal(pickBlock(blocks, 'b2'), blocks[1]))
  it('null → 첫 블록', () => assert.equal(pickBlock(blocks, null), blocks[0]))
  it('없는 id → 첫 블록', () => assert.equal(pickBlock(blocks, 'zz'), blocks[0]))
  it('빈 배열 → undefined', () => {
    assert.equal(pickBlock([], null), undefined)
    assert.equal(pickBlock([], 'b1'), undefined)
  })
})

describe('blockLabel', () => {
  it('B{index+1} 접두 + 첫 필드 요약', () => {
    assert.equal(blockLabel(blk('b1', '가벼운 머그컵', '두번째'), 0), 'B1 가벼운 머그컵')
    assert.equal(blockLabel(blk('b9', 'x'), 2), 'B3 x')
  })

  it('공백을 하나로 줄이고 trim', () => {
    assert.equal(blockLabel(blk('b1', '  a\n b '), 0), 'B1 a b')
  })

  it('정확히 20자 → 그대로', () => {
    const t = 'x'.repeat(20)
    assert.equal(blockLabel(blk('b1', t), 0), `B1 ${t}`)
  })

  it('21자 이상 → 19자 + …', () => {
    assert.equal(blockLabel(blk('b1', 'x'.repeat(21)), 0), `B1 ${'x'.repeat(19)}…`)
    assert.equal(blockLabel(blk('b1', 'y'.repeat(50)), 0), `B1 ${'y'.repeat(19)}…`)
  })

  it('필드 없음·빈 텍스트(공백만 포함) → blockId', () => {
    assert.equal(blockLabel(blk('hero'), 0), 'B1 hero')
    assert.equal(blockLabel(blk('hero', ''), 1), 'B2 hero')
    assert.equal(blockLabel(blk('hero', '   \n '), 0), 'B1 hero')
  })
})

describe('copyText', () => {
  it('writeText resolve → true, 받은 텍스트 그대로 전달', async () => {
    const got: string[] = []
    const ok = await copyText('<div>최종</div>', { writeText: async (t: string) => { got.push(t) } })
    assert.equal(ok, true)
    assert.deepEqual(got, ['<div>최종</div>'])
  })

  it('writeText reject → false', async () => {
    assert.equal(await copyText('x', { writeText: () => Promise.reject(new Error('denied')) }), false)
  })

  it('undefined 명시 → 기본값 navigator.clipboard(node에는 없음) → false', async () => {
    assert.equal(globalThis.navigator?.clipboard, undefined)
    assert.equal(await copyText('x', undefined), false)
  })
})
