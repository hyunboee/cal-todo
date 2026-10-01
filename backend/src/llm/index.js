// LY-08: provider·모델 이름은 이 파일과 config.js에만 둔다.
import { setTimeout as sleep } from 'node:timers/promises'
import { generateText } from 'ai'
import { google } from '@ai-sdk/google'
import { anthropic } from '@ai-sdk/anthropic'
import { query } from '../db.js'
import { AppError } from '../lib/errors.js'
import {
  LLM_MAIN, LLM_LIGHT, LLM_TIMEOUT_MS, LLM_DAILY_LIMIT, LLM_CONCURRENCY,
  LLM_QUEUE_MAX, LLM_QUEUE_WAIT_MS, LLM_RETRY_AFTER_SEC,
} from '../config.js'

export function parseModel(value) {
  const i = value.indexOf(':')
  return { provider: value.slice(0, i), modelId: value.slice(i + 1) }
}

// 호출 시점에 읽는다(테스트가 교체 가능)
export const roleModels = { MAIN: parseModel(LLM_MAIN), LIGHT: parseModel(LLM_LIGHT) }

const providers = { google, anthropic }
export function resolveModel(role) {
  const { provider, modelId } = roleModels[role]
  return provider === 'mock' ? null : providers[provider](modelId)
}

const busy = () => Object.assign(new AppError(503, 'LLM_BUSY'), { retryAfter: LLM_RETRY_AFTER_SEC })

// D-29: 동시 실행 max, 대기열 queueMax, 대기 waitMs 초과 시 503
export function createSemaphore(max, queueMax, waitMs) {
  const waiters = []
  const grant = () => {
    let done = false
    return () => {
      if (done) return
      done = true
      const w = waiters.shift()
      if (w) {
        clearTimeout(w.timer)
        w.resolve(grant()) // 자리를 그대로 넘긴다(active 유지)
      } else s.active--
    }
  }
  const s = {
    active: 0,
    get queued() { return waiters.length },
    acquire() {
      if (s.active < max) {
        s.active++
        return Promise.resolve(grant())
      }
      if (waiters.length >= queueMax) return Promise.reject(busy())
      return new Promise((resolve, reject) => {
        const w = { resolve }
        w.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1)
          reject(busy())
        }, waitMs)
        waiters.push(w)
      })
    },
  }
  return s
}

// ponytail: 프로세스별 세마포어(PRD-R-4, BE-25)
export const semaphores = {
  MAIN: createSemaphore(LLM_CONCURRENCY.MAIN, LLM_QUEUE_MAX, LLM_QUEUE_WAIT_MS),
  LIGHT: createSemaphore(LLM_CONCURRENCY.LIGHT, LLM_QUEUE_MAX, LLM_QUEUE_WAIT_MS),
}

export const MOCK_USPS = ['가벼운 무게', '강력한 흡입력', '긴 배터리 수명']
const MOCK_MAIN_HTML = `<section><h2>핵심 특징</h2><p class="lead" onclick="alert(1)">가볍고 강력한 흡입력</p></section>
<script>alert(1)</script>
<section data-block-id="b1"><h3>사용 방법</h3><p>충전 후 버튼을 누르세요</p>{IMGS}</section>
<div style="background:url(https://evil.example/x.png)"><p><a href="javascript:alert(1)">자세히</a></p></div>
<link rel="stylesheet" href="https://evil.example/x.css"><style>p{color:red}</style>`

// QA-03: mock:ok | mock:fail | mock:delay:<ms>
async function mockGenerate(role, modelId, prompt, signal) {
  const delay = /^delay:(\d+)$/.exec(modelId)
  if (delay) await sleep(Number(delay[1]), undefined, { signal })
  else if (modelId !== 'ok') throw new Error('mock failure')
  if (role === 'LIGHT') return { text: JSON.stringify(MOCK_USPS) }
  const imgs = [...new Set(prompt.match(/asset:(?:[0-9a-f-]{36}|\d+)\b/g) ?? [])].map((a) => `<img src="${a}" alt="">`)
  return { text: MOCK_MAIN_HTML.replace('{IMGS}', imgs.join('')) }
}

const log = (fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }))

// 아키텍처 6장: 일일 상한 → 세마포어 → 호출(타임아웃) → 사용 로그(성공·실패 모두 1행, FR-28)
export async function callRole(role, { system, prompt }, { userId, projectId = null }) {
  const sem = semaphores[role]
  const rejected = (code) => log({ level: 'warn', msg: 'llm_rejected', userId, role, code, queue: sem.queued })

  // DEC-10, D-28. ponytail: 동시 요청은 상한을 몇 건 넘을 수 있음(프로젝트 선점이 1건으로 묶음)
  const used = await query(
    `SELECT count(*)::int AS count FROM llm_usage_logs WHERE user_id = $1 AND role = $2
       AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`,
    [userId, role],
  )
  if (used.rows[0].count >= LLM_DAILY_LIMIT[role]) {
    rejected('DAILY_LLM_LIMIT')
    throw new AppError(429, 'DAILY_LLM_LIMIT')
  }

  let release
  try {
    release = await sem.acquire()
  } catch (e) {
    rejected(e.code)
    throw e
  }

  const { provider, modelId } = roleModels[role]
  const start = performance.now()
  let result, error
  try {
    const abortSignal = AbortSignal.timeout(LLM_TIMEOUT_MS) // NFR-02
    result = provider === 'mock'
      ? await mockGenerate(role, modelId, prompt, abortSignal)
      : await generateText({ model: resolveModel(role), system, prompt, abortSignal, maxRetries: 0 })
  } catch (e) {
    error = e
  }
  release()
  const ms = Math.round(performance.now() - start)
  await query(
    `INSERT INTO llm_usage_logs (user_id, project_id, role, provider, model_id, tokens_in, tokens_out, latency_ms, success)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, projectId, role, provider, modelId, result?.usage?.inputTokens ?? null, result?.usage?.outputTokens ?? null, ms, !error],
  )
  log({
    level: error ? 'error' : 'info', msg: 'llm_call', userId, projectId, role, provider, model: modelId, ms,
    success: !error, queue: sem.queued, active: sem.active, ...(error && { error: error.name }),
  })
  if (error) throw new AppError(502, 'UPSTREAM_FAILED')
  return { text: result.text }
}
