import { Link, useNavigate } from 'react-router'
import { useMe } from '../hooks/auth.ts'
import { useProjects } from '../hooks/projects.ts'
import { messageOf } from '../messages.ts'
import { isEligible, projectPath } from '../projectView.ts'
import type { ProjectStatus } from '../api/types.ts'
import styles from './ProjectsPage.module.css'

const ACTION: Record<ProjectStatus, string> = {
  DRAFT: '이어서 작성', ANALYZED: '이어서 작성', GENERATED: '이어서 편집', EDITING: '이어서 편집', PUBLISHED: '보기',
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const me = useMe()
  const projects = useProjects()
  const canCreate = isEligible(me.data)
  const create = (
    <button type="button" className="btn-primary" disabled={!canCreate} onClick={() => void navigate('/app/projects/new')}>
      + 새 프로젝트
    </button>
  )

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>내 프로젝트</h1>
        {create}
      </div>
      {projects.isPending && <p className="loading"><span className="spinner" />불러오는 중</p>}
      {projects.isError && <p className="field-error" role="alert">{messageOf(projects.error)}</p>}
      {projects.data?.length === 0 && (
        <div className={`card ${styles.empty}`}>
          <p>아직 프로젝트가 없습니다.</p>
          {create}
        </div>
      )}
      <ul className={styles.list}>
        {projects.data?.map((p) => (
          <li key={p.id} className="card">
            <Link className={styles.row} to={projectPath(p)}>
              <span className={styles.name}>{p.form.productName || '(제목 없음)'}</span>
              <span className={p.status === 'PUBLISHED' ? 'badge badge-published' : 'badge'}>{p.status}</span>
              <span className={styles.date}>{new Date(p.createdAt).toLocaleDateString('ko-KR')}</span>
              <span className={styles.action}>{ACTION[p.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
