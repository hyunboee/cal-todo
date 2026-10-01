// OPS-02 PRD-V-6: LLM mock 동시 생성 200건(QA-06). 응답은 200 또는 503 + Retry-After만, 서버 다운 0, 종료 후 선점 누수 0
// 서버: LLM_MAIN=mock:ok(운영과 같은 구성). 초과분 503을 실제로 보려면 mock:delay:<ms>로 호출을 늘린다
// (프로세스당 동시 20 + 대기 100, 대기 30초 초과도 503. PM2 2프로세스면 용량도 2배).
// 실행: k6 run -e BASE=http://localhost:3100 backend/test/load/llm-generate.js   (축소: -e N=50)
// 사전 데이터: setup()이 계정 N개를 가입시킨 뒤 지급 명령(scripts/grant.js, 이메일 인증 포함)을 출력하고
// 마지막 계정이 인증될 때까지 기다린다. 다른 터미널의 backend/에서 출력된 명령을 실행하면 프로젝트·이미지를 만들고 시작한다.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'
import encoding from 'k6/encoding'

const BASE = __ENV.BASE || 'http://localhost:3100'
const N = Number(__ENV.N || 200)
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const PNG = encoding.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
const FORM = { productName: '무선 청소기', category: '가전', intro: '가볍고 강력한 흡입력의 무선 청소기입니다.' }

const ok200 = new Counter('generate_200')
const busy503 = new Counter('generate_503')
const leaks = new Counter('reservation_leaks')

export const options = {
  setupTimeout: '15m',
  scenarios: { gen: { executor: 'per-vu-iterations', vus: N, iterations: 1, maxDuration: '3m' } },
  thresholds: { checks: ['rate==1'], reservation_leaks: ['count==0'] },
}

const auth = (token, extra) => ({ headers: { Authorization: `Bearer ${token}`, ...extra } })

// 50개씩 병렬, 기대 상태가 아니면 setup 실패
function batch(reqs, status) {
  const out = []
  for (let i = 0; i < reqs.length; i += 50) {
    for (const r of http.batch(reqs.slice(i, i + 50))) {
      if (r.status !== status) throw new Error(`${r.request.method} ${r.url} ${r.status} ${r.body}`)
      out.push(r)
    }
  }
  return out
}

export function setup() {
  const run = Date.now().toString(36)
  const emails = Array.from({ length: N }, (_, i) => `load-${run}-${i}@load.test`)
  const tokens = batch(emails.map((email) => ['POST', `${BASE}/api/auth/signup`,
    JSON.stringify({ email, password: 'load-test-pw' }), { headers: JSON_HEADERS }]), 201).map((r) => r.json('accessToken'))

  console.log(`backend/에서 실행: for i in $(seq 0 ${N - 1}); do node --env-file=.env scripts/grant.js load-${run}-$i@load.test 1; done`)
  while (!http.get(`${BASE}/api/me`, auth(tokens[N - 1])).json('emailVerified')) sleep(2)

  const projects = batch(tokens.map((t) => ['POST', `${BASE}/api/projects`, JSON.stringify({ form: FORM }),
    auth(t, JSON_HEADERS)]), 201).map((r) => ({ id: r.json('id'), version: r.json('version') }))
  batch(projects.map((p, i) => ['POST', `${BASE}/api/projects/${p.id}/assets`,
    { file: http.file(PNG, 'a.png', 'image/png') }, auth(tokens[i])]), 201)
  return { tokens, projects }
}

export default function ({ tokens, projects }) {
  const i = __VU - 1
  const { id, version } = projects[i]
  const r = http.post(`${BASE}/api/projects/${id}/generate`, JSON.stringify({ version }),
    { ...auth(tokens[i], JSON_HEADERS), timeout: '120s' })
  if (r.status === 200) ok200.add(1)
  if (r.status === 503) busy503.add(1)
  check(r, { '200 또는 503 + Retry-After': (x) => x.status === 200 || (x.status === 503 && !!x.headers['Retry-After']) })
}

export function teardown({ tokens, projects }) {
  check(http.get(`${BASE}/healthz`), { 'healthz 200(다운 0)': (r) => r.status === 200 })
  // 종료 후 active_job_type IS NOT NULL 0건(BR-47)
  batch(projects.map((p, i) => ['GET', `${BASE}/api/projects/${p.id}`, null, auth(tokens[i])]), 200)
    .forEach((r) => { if (r.json('activeJobType') !== null) leaks.add(1) })
}
