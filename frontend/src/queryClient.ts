import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

export type ErrorLike = { status?: number; retryAfter?: number; projectId?: string }

export const MAX_503_RETRIES = 3 // [가정]

const asErr = (e: unknown): ErrorLike => (typeof e === 'object' && e !== null ? e : {})

// 503만 재시도
export const retry = (count: number, e: unknown) =>
  asErr(e).status === 503 && count < MAX_503_RETRIES

// Retry-After(초)가 있으면 그 값, 없으면 지수 백오프(상한 30초)
export const retryDelay = (count: number, e: unknown) => {
  const { retryAfter } = asErr(e)
  return retryAfter !== undefined ? retryAfter * 1000 : Math.min(1000 * 2 ** count, 30_000)
}

// 409면 해당 프로젝트 쿼리 무효화(LY-10)
export function onApiError(e: unknown) {
  const { status, projectId } = asErr(e)
  if (status !== 409) return
  void queryClient.invalidateQueries({ queryKey: projectId ? ['project', projectId] : ['project'] })
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: { queries: { retry, retryDelay }, mutations: { retry, retryDelay } },
})
