import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Me, Project } from './api/types.ts'
import type { AnalysisResult } from './api/analyze.ts'
import { ANALYZE_MAX, analyzeErrorView, analyzeFlags, sameSet, uspChoices } from './analyzeView.ts'
import { messageOf } from './messages.ts'

const me: Me = { email: 'a@b.c', emailVerified: true, balance: 3 }

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', status: 'DRAFT', version: 1, form: {}, selectedUsps: [],
  analyzeCount: 0, regenCount: 0, aiEditCount: 0, aiEditFailCount: 0, aiImageCount: 0, blockRegenCount: 0,
  activeJobType: null, activeJobStartedAt: null, publishedAt: null, createdAt: '2026-10-01T00:00:00Z',
  ...over,
})

const URL_OK = 'https://www.coupang.com/vp/products/1'

const analysis: AnalysisResult = {
  sourceUrl: URL_OK, uspCandidates: ['가볍다', '튼튼하다', '세척 쉬움'], analyzedAt: '2026-10-01T00:00:00Z',
}

const s = (over: Partial<{ pending: boolean; url: string; selected: string[] }> = {}) =>
  ({ pending: false, url: URL_OK, selected: [] as string[], ...over })
const NONE = { analyze: false, save: false, skip: false, generate: false }

describe('상수(백엔드 config.js와 같은 값)', () => {
  it('ANALYZE_MAX 3', () => assert.equal(ANALYZE_MAX, 3))
})

describe('sameSet', () => {
  it('같은 원소 같은 순서 → true', () => assert.equal(sameSet(['a', 'b'], ['a', 'b']), true))
  it('순서만 다름 → true', () => assert.equal(sameSet(['a', 'b'], ['b', 'a']), true))
  it('원소 다름·길이 다름 → false', () => {
    assert.equal(sameSet(['a', 'b'], ['a', 'c']), false)
    assert.equal(sameSet(['a'], ['a', 'b']), false)
  })
  it('둘 다 빈 배열 → true', () => assert.equal(sameSet([], []), true))
})

describe('uspChoices', () => {
  it('analysis 있음 → uspCandidates', () => {
    assert.deepEqual(uspChoices(project({ status: 'ANALYZED', selectedUsps: ['가볍다'] }), analysis), analysis.uspCandidates)
  })
  it('analysis 없음 + ANALYZED → selectedUsps', () => {
    assert.deepEqual(uspChoices(project({ status: 'ANALYZED', selectedUsps: ['가볍다'] }), undefined), ['가볍다'])
  })
  it('analysis 없음 + DRAFT → []', () => {
    assert.deepEqual(uspChoices(project({ status: 'DRAFT' }), undefined), [])
  })
})

describe('analyzeFlags', () => {
  const draft = project({ status: 'DRAFT' })
  const analyzed = project({ status: 'ANALYZED', selectedUsps: ['가볍다', '튼튼하다'] })

  it('DRAFT 기본 → analyze·skip true', () => {
    assert.deepEqual(analyzeFlags(draft, me, s()), { analyze: true, save: false, skip: true, generate: false })
  })

  it('url 빈 값·공백만 → analyze false', () => {
    assert.equal(analyzeFlags(draft, me, s({ url: '   ' })).analyze, false)
    assert.equal(analyzeFlags(draft, me, s({ url: '' })).analyze, false)
  })

  it('analyzeCount 3 → analyze false, skip true (2는 analyze true)', () => {
    const f = analyzeFlags(project({ analyzeCount: 3 }), me, s())
    assert.equal(f.analyze, false)
    assert.equal(f.skip, true)
    assert.equal(analyzeFlags(project({ analyzeCount: 2 }), me, s()).analyze, true)
  })

  it('DRAFT 선택 1개 → save true', () => {
    assert.equal(analyzeFlags(draft, me, s({ selected: ['가볍다'] })).save, true)
  })

  it('ANALYZED 동일 선택(순서 무관) → generate true, save·skip false', () => {
    assert.deepEqual(analyzeFlags(analyzed, me, s({ selected: ['튼튼하다', '가볍다'] })),
      { analyze: true, save: false, skip: false, generate: true })
  })

  it('ANALYZED 선택 변경 → generate false, save true', () => {
    const f = analyzeFlags(analyzed, me, s({ selected: ['가볍다'] }))
    assert.equal(f.generate, false)
    assert.equal(f.save, true)
  })

  it('ANALYZED 선택 0개 → save false', () => {
    assert.equal(analyzeFlags(analyzed, me, s({ selected: [] })).save, false)
  })

  it('pending → 전부 false', () => {
    assert.deepEqual(analyzeFlags(draft, me, s({ pending: true })), NONE)
    assert.deepEqual(analyzeFlags(analyzed, me, s({ pending: true, selected: ['가볍다'] })), NONE)
  })

  it('activeJobType 있음 → 전부 false', () => {
    assert.deepEqual(analyzeFlags(project({ activeJobType: 'ANALYZE', activeJobStartedAt: '2026-10-01T00:00:00Z' }), me, s()), NONE)
  })

  it('자격 없음(me undefined·미인증·잔액 0) → 전부 false', () => {
    for (const m of [undefined, { ...me, emailVerified: false }, { ...me, balance: 0 }]) {
      assert.deepEqual(analyzeFlags(draft, m, s({ selected: ['가볍다'] })), NONE)
      assert.deepEqual(analyzeFlags(analyzed, m, s({ selected: ['가볍다', '튼튼하다'] })), NONE)
    }
  })

  it('GENERATED·EDITING·PUBLISHED → 전부 false', () => {
    for (const status of ['GENERATED', 'EDITING', 'PUBLISHED'] as const) {
      assert.deepEqual(analyzeFlags(project({ status }), me, s({ selected: ['가볍다'] })), NONE)
    }
  })
})

describe('analyzeErrorView', () => {
  const EMPTY = { urlError: null, crawlFailed: false, message: null }

  it('null·undefined → 비어 있음', () => {
    assert.deepEqual(analyzeErrorView(null), EMPTY)
    assert.deepEqual(analyzeErrorView(undefined), EMPTY)
  })

  it('400 → urlError(쿠팡 URL 형식 안내)만', () => {
    const v = analyzeErrorView({ status: 400, code: 'VALIDATION_FAILED' })
    assert.ok(v.urlError?.includes('coupang.com/vp/products'))
    assert.equal(v.crawlFailed, false)
    assert.equal(v.message, null)
  })

  it('502 → crawlFailed + "분석 없이" 안내', () => {
    const v = analyzeErrorView({ status: 502, code: 'UPSTREAM_FAILED' })
    assert.equal(v.urlError, null)
    assert.equal(v.crawlFailed, true)
    assert.ok(v.message?.includes('분석 없이'))
  })

  it('409·429 → 비어 있음(전역 토스트)', () => {
    assert.deepEqual(analyzeErrorView({ status: 409, code: 'VERSION_CONFLICT' }), EMPTY)
    assert.deepEqual(analyzeErrorView({ status: 429, code: 'ANALYZE_LIMIT' }), EMPTY)
  })

  it('500·NETWORK_ERROR(status 0) → message = messageOf(e)', () => {
    for (const e of [{ status: 500, code: 'HTTP_ERROR' }, { status: 0, code: 'NETWORK_ERROR' }]) {
      assert.deepEqual(analyzeErrorView(e), { urlError: null, crawlFailed: false, message: messageOf(e) })
    }
  })
})
