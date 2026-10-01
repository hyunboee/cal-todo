import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { ANALYZE_MAX, analyzeErrorView, analyzeFlags, uspChoices } from '../analyzeView.ts'
import type { Project } from '../api/types.ts'
import { Banner } from '../components/Banner.tsx'
import { useMe } from '../hooks/auth.ts'
import { useAnalysis, useAnalyze, useSaveUsps } from '../hooks/analyze.ts'
import { useProject } from '../hooks/projects.ts'
import { messageOf } from '../messages.ts'
import { projectPath } from '../projectView.ts'
import styles from './AnalyzePage.module.css'

export function AnalyzePage() {
  const { id } = useParams()
  const project = useProject(id)
  if (project.isPending) return <p className="loading"><span className="spinner" />불러오는 중</p>
  if (project.isError) return <p className="field-error" role="alert">{messageOf(project.error)}</p>
  const p = project.data
  if (p.status !== 'DRAFT' && p.status !== 'ANALYZED') return <Navigate to={projectPath(p)} replace />
  return <AnalyzeBody key={p.id} project={p} />
}

function AnalyzeBody({ project: p }: { project: Project }) {
  const navigate = useNavigate()
  const me = useMe()
  const analyze = useAnalyze(p.id)
  const saveUsps = useSaveUsps(p.id)
  const analysis = useAnalysis(p.id).data
  const [url, setUrl] = useState('')
  const [selected, setSelected] = useState<string[]>(p.selectedUsps)
  const choices = uspChoices(p, analysis)
  const err = analyzeErrorView(analyze.error)
  const flags = analyzeFlags(p, me.data, { pending: analyze.isPending || saveUsps.isPending, url, selected })
  const saveStatus = saveUsps.error?.status
  const saveError = saveUsps.isError && saveStatus !== 409 && saveStatus !== 429 ? messageOf(saveUsps.error) : null
  const used = p.analyzeCount >= ANALYZE_MAX
  const goGenerate = () => void navigate(`/app/projects/${p.id}/edit`, { state: { generate: true } })
  const toggle = (u: string) => setSelected((s) => (s.includes(u) ? s.filter((x) => x !== u) : [...s, u]))

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{p.form.productName || '(제목 없음)'} · 2/2 경쟁사 분석 (선택)</h1>
      {analyze.isPending || p.activeJobType === 'ANALYZE' ? (
        <Banner tone="info" spinner>분석 중입니다…</Banner>
      ) : p.activeJobType ? (
        <Banner tone="info">진행 중인 작업이 있습니다</Banner>
      ) : null}
      {analyze.isPending && analyze.failureReason?.status === 503 && (
        <Banner tone="info">요청이 많습니다. {analyze.failureReason.retryAfter ?? 10}초 뒤 다시 시도합니다</Banner>
      )}

      <section className={`card ${styles.card}`}>
        <label>
          <span className="field-label">쿠팡 상위 상품 URL</span>
          <input
            className={err.urlError ? 'input input-error' : 'input'}
            inputMode="url"
            placeholder="https://www.coupang.com/vp/products/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={!!err.urlError}
            aria-describedby={err.urlError ? 'err-url' : undefined}
          />
        </label>
        {err.urlError && <p id="err-url" className="field-error" role="alert">{err.urlError}</p>}
        {err.message && <p className="field-error" role="alert">{err.message}</p>}
        <div className={styles.row}>
          <span className={`${styles.micro} ${used ? styles.warn : ''}`}>분석 시도 {p.analyzeCount}/{ANALYZE_MAX} (실패 포함)</span>
          <button type="button" className="btn-primary btn-sm" disabled={!flags.analyze} onClick={() => analyze.mutate(url, { onSuccess: () => setSelected([]) })}>
            {analyze.isPending && <span className="spinner" />}분석 시작
          </button>
        </div>
        {used && <p className="field-hint">분석 횟수를 모두 사용했습니다. 분석 없이 생성하세요.</p>}
        {err.crawlFailed && (
          <div className={styles.actions}>
            <button type="button" className="btn-primary" disabled={!flags.skip} onClick={goGenerate}>분석 생략하고 생성</button>
          </div>
        )}
      </section>

      {choices.length > 0 && (
        <section className={`card ${styles.card}`}>
          <h2 className={styles.cardTitle}>USP 후보 - 사용할 항목을 선택하세요</h2>
          <ul className={styles.usps}>
            {choices.map((u) => (
              <li key={u}>
                <label className={styles.usp}>
                  <input type="checkbox" checked={selected.includes(u)} onChange={() => toggle(u)} />
                  {u}
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.row}>
            <span className={styles.micro}>선택 {selected.length}개</span>
            <button type="button" className="btn-secondary" disabled={!flags.save} onClick={() => saveUsps.mutate(selected)}>선택 저장</button>
          </div>
          {saveError && <p className="field-error" role="alert">{saveError}</p>}
        </section>
      )}

      {p.status === 'DRAFT' && p.analyzeCount > 0 && !analysis && !analyze.isError && (
        <p className="field-hint">이전 분석 결과는 화면을 벗어나면 다시 볼 수 없습니다. 다시 분석하거나 분석 없이 생성하세요.</p>
      )}

      <div className={styles.actions}>
        {!err.crawlFailed && (
          <button type="button" className="btn-secondary" disabled={!flags.skip} onClick={goGenerate}>분석 생략하고 생성</button>
        )}
        <button type="button" className="btn-primary" disabled={!flags.generate} onClick={goGenerate}>선택한 USP로 생성</button>
      </div>
    </main>
  )
}
