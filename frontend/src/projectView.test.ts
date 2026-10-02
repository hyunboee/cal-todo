import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Me, Project, ProjectStatus } from './api/types.ts'
import {
  AI_IMAGE_MAX, ASSET_MAX, BLOCK_REGEN_MAX, FORM_MAX, INTRO_MIN, REGEN_MAX, editorFlags, formatElapsed, isEligible, projectPath, validateForm,
} from './projectView.ts'

const me: Me = { email: 'a@b.c', emailVerified: true, balance: 3 }

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', status: 'DRAFT', version: 1, form: {}, selectedUsps: [],
  analyzeCount: 0, regenCount: 0, aiEditCount: 0, aiEditFailCount: 0, aiImageCount: 0, blockRegenCount: 0,
  activeJobType: null, activeJobStartedAt: null, publishedAt: null, createdAt: '2026-10-01T00:00:00Z',
  ...over,
})

const NONE = { generate: false, regenerate: false, save: false, publish: false, image: false, aiImage: false, blockRegen: false }
const ALL_EDIT = { generate: false, regenerate: true, save: true, publish: true, image: true, aiImage: true, blockRegen: true }

describe('상수(백엔드 config.js와 같은 값)', () => {
  it('REGEN_MAX 3, INTRO_MIN 10, FORM_MAX, AI_IMAGE_MAX 10, ASSET_MAX 10', () => {
    assert.equal(REGEN_MAX, 3)
    assert.equal(AI_IMAGE_MAX, 10)
    assert.equal(ASSET_MAX, 10)
    assert.equal(BLOCK_REGEN_MAX, 10)
    assert.equal(INTRO_MIN, 10)
    assert.deepEqual({ ...FORM_MAX }, { productName: 100, category: 50, intro: 1000, toneGuide: 200 })
  })
})

describe('projectPath', () => {
  const cases: [ProjectStatus, string][] = [
    ['DRAFT', '/app/projects/p1/form'],
    ['ANALYZED', '/app/projects/p1/form'],
    ['GENERATED', '/app/projects/p1/edit'],
    ['EDITING', '/app/projects/p1/edit'],
    ['PUBLISHED', '/app/projects/p1/final'],
  ]
  for (const [status, path] of cases) {
    it(`${status} → ${path}`, () => assert.equal(projectPath({ id: 'p1', status }), path))
  }
})

describe('isEligible', () => {
  it('undefined·미인증·잔액 0 → false, 정상 → true', () => {
    assert.equal(isEligible(undefined), false)
    assert.equal(isEligible({ ...me, emailVerified: false }), false)
    assert.equal(isEligible({ ...me, balance: 0 }), false)
    assert.equal(isEligible(me), true)
  })
})

describe('editorFlags', () => {
  it('DRAFT·ANALYZED → generate만 true', () => {
    for (const status of ['DRAFT', 'ANALYZED'] as const) {
      assert.deepEqual(editorFlags(project({ status }), me, false), { ...NONE, generate: true })
    }
  })

  it('GENERATED·EDITING → regenerate·save·publish true, generate false', () => {
    for (const status of ['GENERATED', 'EDITING'] as const) {
      assert.deepEqual(editorFlags(project({ status }), me, false), ALL_EDIT)
    }
  })

  it('regenCount 3(REGEN_MAX) → regenerate만 false', () => {
    assert.deepEqual(editorFlags(project({ status: 'GENERATED', regenCount: 3 }), me, false), { ...ALL_EDIT, regenerate: false })
    assert.equal(editorFlags(project({ status: 'GENERATED', regenCount: 2 }), me, false).regenerate, true)
  })

  it('aiImageCount 10(AI_IMAGE_MAX) → aiImage만 false, 9 → true', () => {
    assert.deepEqual(editorFlags(project({ status: 'EDITING', aiImageCount: 10 }), me, false), { ...ALL_EDIT, aiImage: false })
    assert.equal(editorFlags(project({ status: 'GENERATED', aiImageCount: 9 }), me, false).aiImage, true)
  })

  it('image는 save와 같은 조건(regenCount·aiImageCount 소진과 무관)', () => {
    const f = editorFlags(project({ status: 'GENERATED', regenCount: 3, aiImageCount: 10 }), me, false)
    assert.equal(f.image, true)
    assert.equal(f.image, f.save)
  })

  it('activeJobType AI_IMAGE → 전부 false', () => {
    assert.deepEqual(editorFlags(project({ status: 'EDITING', activeJobType: 'AI_IMAGE' }), me, false), NONE)
  })

  it('PUBLISHED → 전부 false', () => {
    assert.deepEqual(editorFlags(project({ status: 'PUBLISHED' }), me, false), NONE)
  })

  it('activeJobType 있음 → 전부 false', () => {
    assert.deepEqual(editorFlags(project({ status: 'DRAFT', activeJobType: 'GENERATE' }), me, false), NONE)
    assert.deepEqual(editorFlags(project({ status: 'EDITING', activeJobType: 'REGEN' }), me, false), NONE)
  })

  it('pending → 전부 false', () => {
    assert.deepEqual(editorFlags(project({ status: 'DRAFT' }), me, true), NONE)
    assert.deepEqual(editorFlags(project({ status: 'GENERATED' }), me, true), NONE)
  })

  it('자격 없음(me 없음·미인증·잔액 0) → 전부 false', () => {
    for (const m of [undefined, { ...me, emailVerified: false }, { ...me, balance: 0 }]) {
      assert.deepEqual(editorFlags(project({ status: 'DRAFT' }), m, false), NONE)
      assert.deepEqual(editorFlags(project({ status: 'GENERATED' }), m, false), NONE)
    }
  })
})

describe('formatElapsed', () => {
  it('초 단위 내림, 음수는 0초', () => {
    assert.equal(formatElapsed(0), '0초')
    assert.equal(formatElapsed(1999), '1초')
    assert.equal(formatElapsed(65000), '65초')
    assert.equal(formatElapsed(-500), '0초')
  })
})

describe('validateForm', () => {
  const ok = { productName: '머그컵', category: '주방', intro: '열 글자 이상의 소개글', toneGuide: '' }
  const keys = (e: object) => Object.keys(e).sort()

  it('정상 → {}', () => {
    assert.deepEqual(validateForm(ok), {})
    assert.deepEqual(validateForm({ productName: 'a', category: 'b', intro: 'x'.repeat(10) }), {})
  })

  it('빈 값 → productName·category·intro 오류, toneGuide는 선택', () => {
    const e = validateForm({})
    assert.deepEqual(keys(e), ['category', 'intro', 'productName'])
    for (const v of Object.values(e)) assert.ok(typeof v === 'string' && v.length > 0)
  })

  it('공백만 → trim 기준으로 빈 값과 같은 오류', () => {
    const e = validateForm({ productName: '   ', category: ' \t', intro: ' '.repeat(20), toneGuide: '  ' })
    assert.deepEqual(keys(e), ['category', 'intro', 'productName'])
  })

  it('intro 9자 오류, 10자 통과(trim 기준)', () => {
    assert.deepEqual(keys(validateForm({ ...ok, intro: 'x'.repeat(9) })), ['intro'])
    assert.deepEqual(keys(validateForm({ ...ok, intro: ` ${'x'.repeat(9)} ` })), ['intro'])
    assert.deepEqual(validateForm({ ...ok, intro: 'x'.repeat(10) }), {})
  })

  it('intro 1000자 통과, 1001자 오류', () => {
    assert.deepEqual(validateForm({ ...ok, intro: 'x'.repeat(1000) }), {})
    assert.deepEqual(keys(validateForm({ ...ok, intro: 'x'.repeat(1001) })), ['intro'])
  })

  it('productName 100자 통과, 101자 오류', () => {
    assert.deepEqual(validateForm({ ...ok, productName: 'x'.repeat(100) }), {})
    assert.deepEqual(keys(validateForm({ ...ok, productName: 'x'.repeat(101) })), ['productName'])
  })

  it('category 50자 통과, 51자 오류', () => {
    assert.deepEqual(validateForm({ ...ok, category: 'x'.repeat(50) }), {})
    assert.deepEqual(keys(validateForm({ ...ok, category: 'x'.repeat(51) })), ['category'])
  })

  it('toneGuide 200자 통과, 201자 오류', () => {
    assert.deepEqual(validateForm({ ...ok, toneGuide: 'x'.repeat(200) }), {})
    assert.deepEqual(keys(validateForm({ ...ok, toneGuide: 'x'.repeat(201) })), ['toneGuide'])
  })
})
