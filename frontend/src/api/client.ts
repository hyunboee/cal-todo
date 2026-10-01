import { useAuthStore } from '../stores/auth.ts'
import { queryClient } from '../queryClient.ts'

export class ApiError extends Error {
  status: number
  code: string
  retryAfter?: number
  projectId?: string
  constructor(status: number, code: string, message?: string, retryAfter?: number, projectId?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
    this.projectId = projectId
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  json?: unknown
  form?: FormData
  projectId?: string
}

let onAuthLost: () => void = () => {}
export function setOnAuthLost(fn: () => void) {
  onAuthLost = fn
}

// 개발 환경에서만 로깅(frontend/CLAUDE.md). node 테스트에서는 import.meta.env가 undefined
export function logError(...args: unknown[]) {
  if (import.meta.env?.DEV) console.error(...args)
}

export function resetAuth() {
  useAuthStore.getState().clear()
  queryClient.clear()
}

function authLost() {
  resetAuth()
  onAuthLost()
}

let refreshing: Promise<boolean> | null = null

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    if (!res.ok) {
      logError('[api] refresh', res.status)
      return false
    }
    const body = (await res.json()) as { accessToken: string }
    useAuthStore.getState().setAccessToken(body.accessToken)
    return true
  } catch (e) {
    logError('[api] refresh', e)
    return false
  }
}

export function refreshAccessToken(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.form) {
    body = opts.form
  }
  try {
    return await fetch('/api' + path, { method, headers, body, credentials: 'same-origin' })
  } catch {
    logError('[api]', method, path, 0, 'NETWORK_ERROR')
    throw new ApiError(0, 'NETWORK_ERROR', undefined, undefined, opts.projectId)
  }
}

async function toError(res: Response, path: string, opts: RequestOptions): Promise<ApiError> {
  let code = 'HTTP_ERROR'
  let message: string | undefined
  try {
    const b = (await res.json()) as { error?: { code?: string; message?: string } }
    if (b.error?.code) {
      code = b.error.code
      message = b.error.message
    }
  } catch {
    // JSON이 아닌 본문
  }
  const ra = res.headers.get('Retry-After')
  const retryAfter = ra !== null && Number.isFinite(Number(ra)) ? Number(ra) : undefined
  logError('[api]', opts.method ?? 'GET', path, res.status, code)
  return new ApiError(res.status, code, message, retryAfter, opts.projectId)
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const used = useAuthStore.getState().accessToken
  let res = await send(path, opts, used)
  let err: ApiError | null = null
  if (!res.ok) {
    err = await toError(res, path, opts)
    if (err.status === 401 && err.code === 'TOKEN_INVALID') {
      authLost()
      throw err
    }
    if (err.status === 401 && err.code === 'TOKEN_EXPIRED') {
      // 이미 다른 요청이 갱신했으면 갱신 없이 현재 토큰으로 재시도
      if (useAuthStore.getState().accessToken === used && !(await refreshAccessToken())) {
        authLost()
        throw err
      }
      res = await send(path, opts, useAuthStore.getState().accessToken)
      if (!res.ok) {
        err = await toError(res, path, opts)
        if (err.status === 401 && err.code.startsWith('TOKEN_')) authLost()
        throw err
      }
      err = null
    }
  }
  if (err) throw err
  return (res.status === 204 ? undefined : await res.json()) as T
}
