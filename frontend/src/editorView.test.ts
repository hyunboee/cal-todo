import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { PreviewBlock, PreviewImage } from './api/types.ts'
import {
  AI_PROMPT_MAX, EDIT_TEXT_MAX, WIDTH_STEPS, blockLabel, copyText, findImage, jobLabel, pickBlock, validatePrompt,
} from './editorView.ts'

const blk = (blockId: string, ...texts: string[]): PreviewBlock =>
  ({ blockId, fields: texts.map((text, i) => ({ editId: `${blockId}e${i}`, text })), images: [] })

const img = (imageId: string, assetId: string, widthPct = 100, align: PreviewImage['align'] = 'center'): PreviewImage =>
  ({ imageId, assetId, widthPct, align })

const blocks = [blk('b1', '하나'), blk('b2', '둘'), blk('b3', '셋')]

describe('상수(백엔드 config.js와 같은 값)', () => {
  it('EDIT_TEXT_MAX 2000', () => assert.equal(EDIT_TEXT_MAX, 2000))
  it('AI_PROMPT_MAX 500', () => assert.equal(AI_PROMPT_MAX, 500))
  it('WIDTH_STEPS 10~100, 5 단위(image-styles 검증과 같은 값)', () => assert.deepEqual({ ...WIDTH_STEPS }, { min: 10, max: 100, step: 5 }))
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

describe('validatePrompt', () => {
  it('빈 값·공백만 → 문구', () => {
    for (const v of ['', '   ', ' \n\t ']) {
      const m = validatePrompt(v)
      assert.ok(typeof m === 'string' && m.length > 0, JSON.stringify(v))
    }
  })

  it('500자 통과(앞뒤 공백은 trim 기준에서 제외), 501자 → 문구', () => {
    assert.equal(validatePrompt('x'.repeat(500)), null)
    assert.equal(validatePrompt(`  ${'x'.repeat(500)}  `), null)
    const m = validatePrompt('x'.repeat(501))
    assert.ok(typeof m === 'string' && m.length > 0)
  })

  it('HTML 태그 → 문구, 태그가 아닌 < 는 통과', () => {
    for (const v of ['<b>굵게</b>', '앞 </p> 뒤', '<img src=x>', '<!-- 주석 -->', '<SCRIPT>x</SCRIPT>']) {
      const m = validatePrompt(v)
      assert.ok(typeof m === 'string' && m.length > 0, v)
    }
    assert.equal(validatePrompt('1 < 2 그리고 3 > 0'), null)
  })

  it('정상 → null', () => assert.equal(validatePrompt('배경을 흰색으로 바꿔줘'), null))
})

describe('jobLabel', () => {
  it('AI_IMAGE·REGEN·BLOCK_REGEN·그 외', () => {
    assert.equal(jobLabel('BLOCK_REGEN'), '슬라이드 재생성 중')
    assert.equal(jobLabel('AI_IMAGE'), 'AI 이미지 변환 중')
    assert.equal(jobLabel('REGEN'), '재생성 중')
    assert.equal(jobLabel('GENERATE'), '생성 중')
    assert.equal(jobLabel(null), '생성 중')
  })
})

describe('findImage', () => {
  const imgBlocks: PreviewBlock[] = [
    { ...blk('b1', '하나'), images: [img('i1', 'a1'), img('i2', 'a2', 40, 'left')] },
    { ...blk('b2', '둘'), images: [img('i1', 'a3')] },
  ]

  it('blockId·imageId 일치 → 그 이미지(블록마다 imageId 독립)', () => {
    assert.deepEqual(findImage(imgBlocks, { blockId: 'b1', imageId: 'i2' }), img('i2', 'a2', 40, 'left'))
    assert.deepEqual(findImage(imgBlocks, { blockId: 'b2', imageId: 'i1' }), img('i1', 'a3'))
  })

  it('ref null → undefined', () => assert.equal(findImage(imgBlocks, null), undefined))

  it('없는 blockId·imageId → undefined', () => {
    assert.equal(findImage(imgBlocks, { blockId: 'zz', imageId: 'i1' }), undefined)
    assert.equal(findImage(imgBlocks, { blockId: 'b2', imageId: 'i2' }), undefined)
    assert.equal(findImage([], { blockId: 'b1', imageId: 'i1' }), undefined)
  })
})
