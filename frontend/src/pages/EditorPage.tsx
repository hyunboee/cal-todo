import { useEffect, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { Banner } from '../components/Banner.tsx'
import { PreviewFrame } from '../components/PreviewFrame.tsx'
import { useMe } from '../hooks/auth.ts'
import { useGenerate, usePreview, useProject } from '../hooks/projects.ts'
import { messageOf } from '../messages.ts'
import { REGEN_MAX, editorFlags, formatElapsed } from '../projectView.ts'
import styles from './EditorPage.module.css'

export function EditorPage() {
  const { id } = useParams()
  const location = useLocation()
  const intent = (location.state as { generate?: boolean } | null)?.generate === true
  const project = useProject(id)
  const me = useMe()
  const gen = useGenerate(id ?? '')
  const p = project.data
  const busy = gen.isPending || !!p?.activeJobType
  const hasPreview = p?.status === 'GENERATED' || p?.status === 'EDITING'
  const preview = usePreview(id, p?.version, hasPreview && !p?.activeJobType)

  // 경과 시간: 서버의 작업 시작 시각, 없으면 페이지를 연 시점
  const [openedAt] = useState(() => Date.now())
  const [now, setNow] = useState(openedAt)
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [busy])

  if (project.isPending && id) return <p className="loading"><span className="spinner" />불러오는 중</p>
  if (!p) return <p className="field-error" role="alert">{messageOf(project.error)}</p>
  if (p.status === 'PUBLISHED') return <Navigate to={`/app/projects/${p.id}/final`} replace />
  if (!hasPreview && !busy && !intent && !gen.isError) return <Navigate to={`/app/projects/${p.id}/analyze`} replace />

  const flags = editorFlags(p, me.data, gen.isPending)
  const since = gen.submittedAt || (p.activeJobStartedAt ? Date.parse(p.activeJobStartedAt) : openedAt)
  const waiting = gen.isPending && gen.failureReason?.status === 503
  const status = gen.error?.status
  const showError = gen.isError && status !== 409 && status !== 429
  const left = REGEN_MAX - p.regenCount

  return (
    <div className={styles.page}>
      {busy && (
        <Banner tone="info" spinner>
          생성 중입니다... (최대 90초, 경과 {formatElapsed(now - since)})
        </Banner>
      )}
      {waiting && (
        <Banner tone="info">요청이 많습니다. {gen.failureReason?.retryAfter ?? 10}초 뒤 다시 시도합니다</Banner>
      )}
      <div className={styles.toolbar}>
        <span className={styles.meta}>{p.form.productName || '(제목 없음)'} · {p.status} · v{p.version}</span>
        <span className={styles.meta}>재생성 <span className={left <= 0 ? styles.warn : undefined}>{left}/{REGEN_MAX}</span></span>
      </div>
      <div className={styles.body}>
        <section className={styles.canvas} aria-label="미리보기">
          {preview.data ? (
            <PreviewFrame html={preview.data.html} />
          ) : (
            <div className={styles.empty}>
              {busy || (preview.isPending && hasPreview) ? (
                <p className="loading"><span className="spinner" />{busy ? '생성 중' : '불러오는 중'}</p>
              ) : preview.isError ? (
                <p className="field-error" role="alert">{messageOf(preview.error)}</p>
              ) : null}
            </div>
          )}
        </section>
        <aside className={`card ${styles.panel}`}>
          {hasPreview ? (
            <p className="field-hint">블록 편집은 준비 중입니다</p>
          ) : (
            <>
              <button type="button" className="btn-generate" disabled={!flags.generate} onClick={() => gen.mutate()}>
                {gen.isPending && <span className="spinner" />}✦ 상세페이지 생성
              </button>
              {showError && <p className="field-error" role="alert">{messageOf(gen.error)}</p>}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
