// OPS-02 PRD-V-5: 비 LLM API 1,000 VU, p95 <= 300ms, 오류율 < 1%(QA-06)
// 실행: k6 run -e BASE=http://localhost:3100 backend/test/load/api-1000vu.js
// 축소: -e VUS=50 -e DURATION=30s
// 사전 데이터: setup()이 VU 수만큼 계정을 가입시킨다(signup은 리밋 없음). 일반 리밋(60회/분)은 사용자당이라
// VU마다 계정 1개, 반복당 2요청 + 3초 대기(약 40회/분)로 429를 피한다. 부하 전용 DB에서 실행할 것(계정이 남는다).
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE || 'http://localhost:3100'
const VUS = Number(__ENV.VUS || 1000)
const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } }

export const options = {
  setupTimeout: '10m',
  scenarios: { api: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '3m' } },
  // setup(가입·bcrypt)은 제외하고 시나리오 요청만 판정
  thresholds: {
    'http_req_duration{scenario:api}': ['p(95)<=300'],
    'http_req_failed{scenario:api}': ['rate<0.01'],
  },
}

export function setup() {
  const run = Date.now().toString(36)
  const tokens = []
  for (let i = 0; i < VUS; i += 50) {
    const reqs = []
    for (let j = i; j < Math.min(i + 50, VUS); j++) {
      const body = JSON.stringify({ email: `load-${run}-${j}@load.test`, password: 'load-test-pw' })
      reqs.push(['POST', `${BASE}/api/auth/signup`, body, JSON_HEADERS])
    }
    for (const r of http.batch(reqs)) {
      if (r.status !== 201) throw new Error(`signup ${r.status}`)
      tokens.push(r.json('accessToken'))
    }
  }
  return { tokens }
}

export default function ({ tokens }) {
  const auth = { headers: { Authorization: `Bearer ${tokens[__VU - 1]}` } }
  check(http.get(`${BASE}/api/me`, auth), { 'me 200': (r) => r.status === 200 })
  check(http.get(`${BASE}/api/projects`, auth), { 'projects 200': (r) => r.status === 200 })
  sleep(3)
}
