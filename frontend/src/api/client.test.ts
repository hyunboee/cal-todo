import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, refreshAccessToken, request, resetAuth, setOnAuthLost } from './client.ts'
import { useAuthStore } from '../stores/auth.ts'
import { queryClient, retry, retryDelay } from '../queryClient.ts'

type Call = { url: string; init: RequestInit }
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

const realFetch = globalThis.fetch
let calls: Call[] = []
let lost = 0

function mockFetch(handler: Handler) {
  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return Promise.resolve().then(() => handler(String(url), init))
  }) as typeof fetch
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const err = (status: number, code: string, message = code, headers: Record<string, string> = {}) =>
  json({ error: { code, message } }, status, headers)
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name)
const auth = (init: RequestInit) => new Headers(init.headers).get('Authorization')
const isRefresh = (url: string) => url === '/api/auth/refresh'
const refreshCalls = () => calls.filter((c) => isRefresh(c.url)).length
const apiCalls = () => calls.filter((c) => !isRefresh(c.url))
const tick = () => new Promise((r) => setImmediate(r))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// old 토큰은 만료, new 토큰은 성공. refresh는 new 발급
const expiredOld: Handler = (url, init) => {
  if (isRefresh(url)) return json({ accessToken: 'new', expiresIn: 900 })
  return auth(init) === 'Bearer new' ? json({ ok: true }) : err(401, 'TOKEN_EXPIRED')
}

beforeEach(() => {
  useAuthStore.getState().clear()
  queryClient.clear()
  calls = []
  lost = 0
  setOnAuthLost(() => { lost++ })
})

afterEach(() => {
  globalThis.fetch = realFetch
  setOnAuthLost(() => {})
})

describe('ApiError', () => {
  it('Error 상속, name·status·code, message 기본값은 code', () => {
    const e = new ApiError(503, 'LLM_BUSY', undefined, 10, 'p1')
    assert.ok(e instanceof Error)
    assert.equal(e.name, 'ApiError')
    assert.equal(e.status, 503)
    assert.equal(e.code, 'LLM_BUSY')
    assert.equal(e.message, 'LLM_BUSY')
    assert.equal(e.retryAfter, 10)
    assert.equal(e.projectId, 'p1')
    assert.equal(new ApiError(400, 'VALIDATION_FAILED', '잘못됨').message, '잘못됨')
  })
})

describe('request: 요청 구성', () => {
  it('GET → /api 접두, credentials include, 토큰 없으면 Authorization 없음', async () => {
    mockFetch(() => json({ email: 'a@b.c' }))
    assert.deepEqual(await request('/me'), { email: 'a@b.c' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/me')
    assert.equal(calls[0].init.credentials, 'include')
    assert.equal(calls[0].init.method ?? 'GET', 'GET')
    assert.equal(header(calls[0], 'Authorization'), null)
  })

  it('토큰 있으면 Bearer 헤더', async () => {
    useAuthStore.getState().setAccessToken('tok')
    mockFetch(() => json({}))
    await request('/me')
    assert.equal(header(calls[0], 'Authorization'), 'Bearer tok')
  })

  it('json → method, Content-Type application/json, body 문자열', async () => {
    mockFetch(() => json({ id: 'p1' }, 201))
    assert.deepEqual(await request('/projects', { method: 'POST', json: { form: { productName: 'x' } } }), { id: 'p1' })
    assert.equal(calls[0].init.method, 'POST')
    assert.match(header(calls[0], 'Content-Type') ?? '', /^application\/json/)
    assert.equal(typeof calls[0].init.body, 'string')
    assert.deepEqual(JSON.parse(calls[0].init.body as string), { form: { productName: 'x' } })
  })

  it('form → body가 FormData 그대로, Content-Type 직접 지정 안 함', async () => {
    mockFetch(() => json({ id: 'a1' }, 201))
    const fd = new FormData()
    fd.append('file', new Blob(['x'], { type: 'image/png' }))
    await request('/projects/p1/assets', { method: 'POST', form: fd })
    assert.equal(calls[0].init.body, fd)
    assert.equal(header(calls[0], 'Content-Type'), null)
  })

  it('전역 fetch는 호출 시점에 찾는다', async () => {
    mockFetch(() => json({ n: 1 }))
    assert.deepEqual(await request('/me'), { n: 1 })
    mockFetch(() => json({ n: 2 }))
    assert.deepEqual(await request('/me'), { n: 2 })
  })
})

describe('request: 응답 처리', () => {
  it('200·201 → JSON, 204 → undefined', async () => {
    mockFetch(() => json({ a: 1 }))
    assert.deepEqual(await request('/x'), { a: 1 })
    mockFetch(() => json({ b: 2 }, 201))
    assert.deepEqual(await request('/x', { method: 'POST', json: {} }), { b: 2 })
    mockFetch(() => new Response(null, { status: 204 }))
    assert.equal(await request('/auth/logout', { method: 'POST' }), undefined)
  })

  it('{error} 본문 → ApiError(status·code·message·projectId)', async () => {
    mockFetch(() => err(404, 'NOT_FOUND', '없음'))
    await assert.rejects(request('/projects/p1', { projectId: 'p1' }), (e: unknown) => {
      assert.ok(e instanceof ApiError)
      assert.equal(e.status, 404)
      assert.equal(e.code, 'NOT_FOUND')
      assert.equal(e.message, '없음')
      assert.equal(e.projectId, 'p1')
      assert.equal(e.retryAfter, undefined)
      return true
    })
  })

  it('503 + Retry-After 10 → retryAfter 10, 헤더 없으면 undefined', async () => {
    mockFetch(() => err(503, 'LLM_BUSY', 'LLM_BUSY', { 'Retry-After': '10' }))
    await assert.rejects(request('/x'), (e: unknown) => e instanceof ApiError && e.status === 503 && e.retryAfter === 10)
    mockFetch(() => err(503, 'LLM_BUSY'))
    await assert.rejects(request('/x'), (e: unknown) => e instanceof ApiError && e.status === 503 && e.retryAfter === undefined)
  })

  it('JSON 아닌 오류 본문 → HTTP_ERROR', async () => {
    mockFetch(() => new Response('<html>oops</html>', { status: 500 }))
    await assert.rejects(request('/x'), (e: unknown) => e instanceof ApiError && e.status === 500 && e.code === 'HTTP_ERROR')
  })

  it('fetch reject → status 0 NETWORK_ERROR', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch') })
    await assert.rejects(request('/x'), (e: unknown) => e instanceof ApiError && e.status === 0 && e.code === 'NETWORK_ERROR')
  })
})

describe('request: 401 처리', () => {
  it('TOKEN_EXPIRED → refresh 1회, 새 토큰 저장, 새 Bearer로 재시도 성공', async () => {
    useAuthStore.getState().setAccessToken('old')
    mockFetch(expiredOld)
    assert.deepEqual(await request('/me'), { ok: true })
    assert.equal(refreshCalls(), 1)
    assert.equal(useAuthStore.getState().accessToken, 'new')
    assert.deepEqual(apiCalls().map((c) => auth(c.init)), ['Bearer old', 'Bearer new'])
    assert.equal(lost, 0)
  })

  it('동시 5건 TOKEN_EXPIRED → refresh fetch 1회, 5건 모두 새 토큰으로 재시도 성공', async () => {
    useAuthStore.getState().setAccessToken('old')
    const gate = deferred<Response>()
    mockFetch((url, init) => (isRefresh(url) ? gate.promise : expiredOld(url, init)))
    const all = Promise.all(Array.from({ length: 5 }, () => request('/me')))
    // 5건이 모두 401을 받고 refresh 대기에 들어갈 때까지 refresh 응답을 붙잡아 둔다
    for (let i = 0; i < 1000 && (apiCalls().length < 5 || refreshCalls() < 1); i++) await tick()
    assert.equal(apiCalls().length, 5)
    for (let i = 0; i < 20; i++) await tick()
    assert.equal(refreshCalls(), 1)
    gate.resolve(json({ accessToken: 'new', expiresIn: 900 }))
    assert.deepEqual(await all, Array(5).fill({ ok: true }))
    assert.equal(refreshCalls(), 1)
    const retried = apiCalls().slice(5).map((c) => auth(c.init))
    assert.deepEqual(retried, Array(5).fill('Bearer new'))
    assert.equal(lost, 0)
  })

  it('응답 사이에 토큰이 이미 바뀜 → refresh 0회, 현재 토큰으로 재시도', async () => {
    useAuthStore.getState().setAccessToken('old')
    mockFetch((url, init) => {
      if (auth(init) === 'Bearer old') {
        useAuthStore.getState().setAccessToken('cur')
        return err(401, 'TOKEN_EXPIRED')
      }
      return auth(init) === 'Bearer cur' ? json({ ok: true }) : err(401, 'TOKEN_INVALID')
    })
    assert.deepEqual(await request('/me'), { ok: true })
    assert.equal(refreshCalls(), 0)
    assert.deepEqual(apiCalls().map((c) => auth(c.init)), ['Bearer old', 'Bearer cur'])
  })

  for (const [name, refreshRes] of [
    ['refresh 401 REFRESH_INVALID', () => err(401, 'REFRESH_INVALID')],
    ['refresh 네트워크 오류', () => { throw new TypeError('Failed to fetch') }],
  ] as const) {
    it(`${name} → 토큰 null, 캐시 비움, authLost 1회, reject`, async () => {
      useAuthStore.getState().setAccessToken('old')
      queryClient.setQueryData(['me'], { email: 'a@b.c' })
      mockFetch((url, init) => (isRefresh(url) ? refreshRes() : expiredOld(url, init)))
      await assert.rejects(request('/me'), (e: unknown) => e instanceof ApiError && e.status === 401)
      assert.equal(refreshCalls(), 1)
      assert.equal(useAuthStore.getState().accessToken, null)
      assert.equal(queryClient.getQueryData(['me']), undefined)
      assert.equal(lost, 1)
    })
  }

  it('재시도 응답도 401 → authLost, refresh 총 1회', async () => {
    useAuthStore.getState().setAccessToken('old')
    queryClient.setQueryData(['me'], 1)
    mockFetch((url) => (isRefresh(url) ? json({ accessToken: 'new', expiresIn: 900 }) : err(401, 'TOKEN_EXPIRED')))
    await assert.rejects(request('/me'), (e: unknown) => e instanceof ApiError && e.status === 401)
    assert.equal(refreshCalls(), 1)
    assert.equal(apiCalls().length, 2)
    assert.equal(lost, 1)
    assert.equal(useAuthStore.getState().accessToken, null)
    assert.equal(queryClient.getQueryData(['me']), undefined)
  })

  it('TOKEN_INVALID → refresh 0회, authLost, 캐시 비움', async () => {
    useAuthStore.getState().setAccessToken('bad')
    queryClient.setQueryData(['me'], 1)
    mockFetch(() => err(401, 'TOKEN_INVALID'))
    await assert.rejects(request('/me'), (e: unknown) => e instanceof ApiError && e.code === 'TOKEN_INVALID')
    assert.equal(refreshCalls(), 0)
    assert.equal(apiCalls().length, 1)
    assert.equal(lost, 1)
    assert.equal(useAuthStore.getState().accessToken, null)
    assert.equal(queryClient.getQueryData(['me']), undefined)
  })

  it('INVALID_CREDENTIALS → refresh 0회, authLost 0회, reject', async () => {
    mockFetch(() => err(401, 'INVALID_CREDENTIALS'))
    await assert.rejects(
      request('/auth/login', { method: 'POST', json: { email: 'a@b.c', password: 'x' } }),
      (e: unknown) => e instanceof ApiError && e.status === 401 && e.code === 'INVALID_CREDENTIALS',
    )
    assert.equal(refreshCalls(), 0)
    assert.equal(lost, 0)
  })
})

describe('refreshAccessToken', () => {
  it('POST /api/auth/refresh, credentials include. 동시 호출은 fetch 1회 공유, 끝나면 새 fetch', async () => {
    const gate = deferred<Response>()
    mockFetch(() => gate.promise)
    const a = refreshAccessToken()
    const b = refreshAccessToken()
    await tick()
    gate.resolve(json({ accessToken: 'r1', expiresIn: 900 }))
    assert.deepEqual(await Promise.all([a, b]), [true, true])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/auth/refresh')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.credentials, 'include')
    assert.equal(useAuthStore.getState().accessToken, 'r1')

    mockFetch(() => json({ accessToken: 'r2', expiresIn: 900 }))
    assert.equal(await refreshAccessToken(), true)
    assert.equal(calls.length, 2)
    assert.equal(useAuthStore.getState().accessToken, 'r2')
  })

  it('실패(401·네트워크) → false, authLost 미호출', async () => {
    mockFetch(() => err(401, 'REFRESH_INVALID'))
    assert.equal(await refreshAccessToken(), false)
    mockFetch(() => { throw new TypeError('Failed to fetch') })
    assert.equal(await refreshAccessToken(), false)
    assert.equal(lost, 0)
    assert.equal(useAuthStore.getState().accessToken, null)
  })
})

describe('resetAuth', () => {
  it('스토어 토큰과 쿼리 캐시를 모두 비움', () => {
    useAuthStore.getState().setAccessToken('tok')
    queryClient.setQueryData(['me'], 1)
    resetAuth()
    assert.equal(useAuthStore.getState().accessToken, null)
    assert.equal(queryClient.getQueryData(['me']), undefined)
  })
})

describe('queryClient 재시도와 ApiError', () => {
  it('retry(0, ApiError 503) true, retryDelay는 retryAfter(초) → ms', () => {
    assert.equal(retry(0, new ApiError(503, 'LLM_BUSY')), true)
    assert.equal(retryDelay(0, new ApiError(503, 'LLM_BUSY', undefined, 10)), 10_000)
  })
})
