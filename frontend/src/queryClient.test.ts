import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MutationObserver } from '@tanstack/react-query'
import { MAX_503_RETRIES, onApiError, queryClient, retry, retryDelay } from './queryClient.ts'

const invalidated = (key: unknown[]) => queryClient.getQueryState(key)?.isInvalidated

function seed() {
  queryClient.setQueryData(['project', 'p1'], 1)
  queryClient.setQueryData(['project', 'p2'], 2)
  queryClient.setQueryData(['me'], 3)
}

describe('retry', () => {
  it('MAX_503_RETRIES는 3', () => assert.equal(MAX_503_RETRIES, 3))

  it('503 → count 0~2 true, 3 false', () => {
    for (const c of [0, 1, 2]) assert.equal(retry(c, { status: 503 }), true)
    assert.equal(retry(3, { status: 503 }), false)
  })

  it('409/401/500/TypeError/null → false', () => {
    for (const e of [{ status: 409 }, { status: 401 }, { status: 500 }, new TypeError('x'), null]) {
      assert.equal(retry(0, e), false)
    }
  })
})

describe('retryDelay', () => {
  it('retryAfter 있으면 초 → ms (5→5000, 0→0)', () => {
    assert.equal(retryDelay(0, { status: 503, retryAfter: 5 }), 5000)
    assert.equal(retryDelay(2, { status: 503, retryAfter: 0 }), 0)
  })

  it('retryAfter 없으면 지수 백오프, 상한 30000', () => {
    assert.equal(retryDelay(0, { status: 503 }), 1000)
    assert.equal(retryDelay(1, { status: 503 }), 2000)
    assert.equal(retryDelay(10, { status: 503 }), 30_000)
  })
})

describe('onApiError', () => {
  beforeEach(() => queryClient.clear())

  it('409 + projectId → 해당 project만 무효화', async () => {
    seed()
    await onApiError({ status: 409, projectId: 'p1' })
    assert.equal(invalidated(['project', 'p1']), true)
    assert.equal(invalidated(['project', 'p2']), false)
    assert.equal(invalidated(['me']), false)
  })

  it('409, projectId 없음 → project 전체 무효화, me는 유지', async () => {
    seed()
    await onApiError({ status: 409 })
    assert.equal(invalidated(['project', 'p1']), true)
    assert.equal(invalidated(['project', 'p2']), true)
    assert.equal(invalidated(['me']), false)
  })

  it('500/null → 무시', async () => {
    seed()
    await onApiError({ status: 500 })
    await onApiError(null)
    assert.equal(invalidated(['project', 'p1']), false)
    assert.equal(invalidated(['project', 'p2']), false)
    assert.equal(invalidated(['me']), false)
  })
})

describe('queryClient 연결', () => {
  beforeEach(() => queryClient.clear())

  it('queryCache: fetchQuery 409 reject → 무효화', async () => {
    seed()
    await assert.rejects(queryClient.fetchQuery({
      queryKey: ['other'],
      queryFn: () => Promise.reject({ status: 409, projectId: 'p1' }),
    }))
    assert.equal(invalidated(['project', 'p1']), true)
    assert.equal(invalidated(['project', 'p2']), false)
  })

  it('mutationCache: mutate 409 reject → 무효화', async () => {
    seed()
    const observer = new MutationObserver(queryClient, { mutationFn: () => Promise.reject({ status: 409 }) })
    await assert.rejects(observer.mutate())
    assert.equal(invalidated(['project', 'p1']), true)
    assert.equal(invalidated(['project', 'p2']), true)
    assert.equal(invalidated(['me']), false)
  })

  it('defaultOptions에 retry·retryDelay 연결', () => {
    const d = queryClient.getDefaultOptions()
    assert.equal(d.queries?.retry, retry)
    assert.equal(d.queries?.retryDelay, retryDelay)
    assert.equal(d.mutations?.retry, retry)
    assert.equal(d.mutations?.retryDelay, retryDelay)
  })
})
