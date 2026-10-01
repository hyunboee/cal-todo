import { Link, Navigate, useLocation, useParams } from 'react-router'
import { Banner } from '../components/Banner.tsx'
import { useMe } from '../hooks/auth.ts'
import { useFinal } from '../hooks/editor.ts'
import { useProject } from '../hooks/projects.ts'
import { copyText } from '../editorView.ts'
import { messageOf } from '../messages.ts'
import { projectPath } from '../projectView.ts'
import { useUiStore } from '../stores/ui.ts'
import styles from './FinalPage.module.css'

export function FinalPage() {
  const { id } = useParams()
  const location = useLocation()
  const published = (location.state as { published?: boolean } | null)?.published === true
  const project = useProject(id)
  const final = useFinal(id)
  const me = useMe()
  const setToast = useUiStore((s) => s.setToast)
  const p = project.data

  if (final.error?.status === 403) {
    return <Navigate replace to={p && p.status !== 'PUBLISHED' ? projectPath(p) : '/app'} />
  }

  const copy = async () => {
    if (!final.data) return
    if (await copyText(final.data.finalHtml)) setToast({ tone: 'success', text: '복사되었습니다' })
    else setToast({ tone: 'error', text: '복사하지 못했습니다. 코드 영역을 선택해 직접 복사해 주세요' })
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>{p?.form.productName || '(제목 없음)'}</h1>
        <span className="badge badge-published">PUBLISHED</span>
        <Link to="/app" className={`btn-secondary ${styles.back}`}>목록으로</Link>
      </div>
      {published && <Banner tone="info">퍼블리시 완료. 크레딧 1개가 차감되었습니다.</Banner>}
      {me.data && me.data.balance <= 0 && (
        <Banner tone="warn">크레딧이 없습니다. 최종 HTML 복사는 계속 사용할 수 있습니다.</Banner>
      )}
      <section className={`card ${styles.card}`}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>최종 HTML (읽기 전용)</h2>
          <button type="button" className="btn-secondary" disabled={!final.data} onClick={() => void copy()}>
            클립보드에 복사
          </button>
        </div>
        {final.isPending ? (
          <p className="loading"><span className="spinner" />불러오는 중</p>
        ) : final.data ? (
          <pre className={styles.code} tabIndex={0}><code>{final.data.finalHtml}</code></pre>
        ) : (
          <p className="field-error" role="alert">{messageOf(final.error)}</p>
        )}
      </section>
      <section className={`card ${styles.card}`}>
        <h2 className={styles.cardTitle}>WING 붙여넣기 안내</h2>
        <ol className={styles.steps}>
          <li>[클립보드에 복사]를 누릅니다</li>
          <li>WING 상품등록의 상세설명 에디터에 붙여넣습니다</li>
          <li>등록 제출은 WING에서 직접 합니다</li>
        </ol>
        <p className="field-hint">이미지는 공개 주소에서 불러옵니다. 보이지 않으면 잠시 후 이 화면을 다시 열어 복사해 주세요.</p>
      </section>
    </div>
  )
}
