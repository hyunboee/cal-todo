import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { messageOf } from './messages.ts'

const fallback = messageOf(null)

// 백엔드 실제 코드(backend/src/services, routes, middleware)
const CODES = [
  'INVALID_CREDENTIALS', 'VALIDATION_FAILED', 'EMAIL_NOT_VERIFIED', 'INSUFFICIENT_CREDIT',
  'VERSION_CONFLICT', 'INVALID_STATE', 'JOB_IN_PROGRESS',
  'REGEN_LIMIT', 'ANALYZE_LIMIT', 'AI_EDIT_LIMIT', 'AI_IMAGE_LIMIT', 'BLOCK_REGEN_LIMIT', 'RATE_LIMITED', 'DAILY_LLM_LIMIT',
  'UPSTREAM_FAILED', 'LLM_BUSY', 'NOT_FOUND', 'NETWORK_ERROR',
]

describe('messageOf', () => {
  it('기본 문구: null·일반 Error·모르는 코드·undefined가 같은 비어 있지 않은 문구', () => {
    assert.equal(typeof fallback, 'string')
    assert.ok(fallback.length > 0)
    assert.equal(messageOf(new Error('x')), fallback)
    assert.equal(messageOf(undefined), fallback)
    assert.equal(messageOf({ status: 500, code: 'WHATEVER' }), fallback)
  })

  for (const code of CODES) {
    it(`${code} → 비어 있지 않고 기본 문구와 다름`, () => {
      const m = messageOf({ code })
      assert.equal(typeof m, 'string')
      assert.ok(m.length > 0)
      assert.notEqual(m, fallback)
    })
  }

  it('409 코드 3종은 같은 "최신 상태로 갱신" 문구', () => {
    const m = messageOf({ status: 409, code: 'VERSION_CONFLICT' })
    assert.ok(m.includes('최신 상태로 갱신'))
    assert.equal(messageOf({ status: 409, code: 'INVALID_STATE' }), m)
    assert.equal(messageOf({ status: 409, code: 'JOB_IN_PROGRESS' }), m)
  })

  it('BLOCK_REGEN_LIMIT → 슬라이드 재생성 횟수 소진 문구', () => {
    assert.equal(messageOf({ status: 429, code: 'BLOCK_REGEN_LIMIT' }), '슬라이드 재생성 횟수를 모두 사용했습니다')
  })

  it('DAILY_LLM_LIMIT → "내일 0시(한국 시간)" 포함', () => {
    assert.ok(messageOf({ status: 429, code: 'DAILY_LLM_LIMIT' }).includes('내일 0시(한국 시간)'))
  })

  it('overrides 우선(매핑 있는 코드, 없는 코드 모두)', () => {
    assert.equal(messageOf({ code: 'VALIDATION_FAILED' }, { VALIDATION_FAILED: '커스텀' }), '커스텀')
    assert.equal(messageOf({ code: 'WHATEVER' }, { WHATEVER: '모름' }), '모름')
    assert.equal(messageOf({ code: 'NOT_FOUND' }, { VALIDATION_FAILED: '커스텀' }), messageOf({ code: 'NOT_FOUND' }))
  })
})
