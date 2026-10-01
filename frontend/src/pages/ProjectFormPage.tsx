import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import type { Project, ProjectForm } from '../api/types.ts'
import { useMe } from '../hooks/auth.ts'
import { useCreateProject, useProject, useSaveForm, useUploadAsset } from '../hooks/projects.ts'
import { messageOf } from '../messages.ts'
import { FORM_MAX, INTRO_MIN, isEligible, projectPath, validateForm } from '../projectView.ts'
import type { FormErrors } from '../projectView.ts'
import styles from './ProjectFormPage.module.css'

const MAX_IMAGES = 10
type Upload = { key: number; name: string; url: string; state: 'uploading' | 'done' | 'error'; error?: string }
let uploadKey = 0

export function ProjectFormPage() {
  const { id } = useParams()
  const project = useProject(id)
  if (!id) return <FormBody />
  if (project.isPending) return <p className="loading"><span className="spinner" />불러오는 중</p>
  if (project.isError) return <p className="field-error" role="alert">{messageOf(project.error)}</p>
  if (project.data.status !== 'DRAFT' && project.data.status !== 'ANALYZED') {
    return <Navigate to={projectPath(project.data)} replace />
  }
  return <FormBody key={id} project={project.data} />
}

function FormBody({ project }: { project?: Project }) {
  const navigate = useNavigate()
  const me = useMe()
  const create = useCreateProject()
  const save = useSaveForm()
  const upload = useUploadAsset()
  const [values, setValues] = useState<ProjectForm>(project?.form ?? {})
  const [errors, setErrors] = useState<FormErrors>({})
  const [projectId, setProjectId] = useState(project?.id)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const busy = uploading || saving || !isEligible(me.data)

  const set = (k: keyof ProjectForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }))

  // 409·429는 onApiError 토스트가 안내하므로 화면 메시지는 그 외 오류만
  function fail(e: unknown) {
    const status = (e as { status?: number } | null)?.status
    setMessage(status === 409 || status === 429 ? null : messageOf(e))
  }

  async function ensureProject(saveExisting: boolean): Promise<string> {
    if (!projectId) {
      const p = await create.mutateAsync(values)
      setProjectId(p.id)
      return p.id
    }
    if (saveExisting) await save.mutateAsync({ id: projectId, form: values })
    return projectId
  }

  async function run(action: (id: string) => void, validate = false) {
    if (validate) {
      const errs = validateForm(values)
      setErrors(errs)
      if (Object.keys(errs).length > 0) return
    }
    setMessage(null)
    setSaving(true)
    try {
      action(await ensureProject(true))
    } catch (e) {
      fail(e)
    } finally {
      setSaving(false)
    }
  }

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setMessage(null)
    setUploading(true)
    try {
      const pid = await ensureProject(false)
      for (const file of files) {
        const key = ++uploadKey
        // ponytail: 썸네일 URL 해제 생략(세션 내 소량), 이미지가 많아지면 revokeObjectURL 추가
        const item: Upload = { key, name: file.name, url: URL.createObjectURL(file), state: 'uploading' }
        setUploads((u) => [...u, item])
        const patch = (p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)))
        try {
          await upload.mutateAsync({ id: pid, file })
          patch({ state: 'done' })
        } catch (err) {
          patch({ state: 'error', error: messageOf(err, { VALIDATION_FAILED: 'jpg/png/webp, 10MB 이하, 최대 10장' }) })
        }
      }
    } catch (err) {
      fail(err)
    } finally {
      setUploading(false)
    }
  }

  const field = (k: keyof ProjectForm) => (errors[k] ? 'input input-error' : 'input')
  const count = (k: keyof ProjectForm) => (
    <span className="field-hint">{(values[k] ?? '').length}/{FORM_MAX[k]}</span>
  )
  const err = (k: keyof ProjectForm) =>
    errors[k] && <span id={`err-${k}`} className="field-error" role="alert">{errors[k]}</span>
  const aria = (k: keyof ProjectForm) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `err-${k}` : undefined })

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{project ? '프로젝트 정보' : '새 프로젝트'}</h1>
      <form className={`card ${styles.form}`} onSubmit={(e) => e.preventDefault()} noValidate>
        <label className={styles.field}>
          <span className="field-label">제품명</span>
          <input className={field('productName')} maxLength={FORM_MAX.productName} value={values.productName ?? ''} onChange={set('productName')} {...aria('productName')} />
          {count('productName')}{err('productName')}
        </label>
        <label className={styles.field}>
          <span className="field-label">카테고리</span>
          <input className={field('category')} maxLength={FORM_MAX.category} value={values.category ?? ''} onChange={set('category')} {...aria('category')} />
          {count('category')}{err('category')}
        </label>
        <label className={styles.field}>
          <span className="field-label">소개글</span>
          <textarea className={errors.intro ? 'textarea input-error' : 'textarea'} maxLength={FORM_MAX.intro} value={values.intro ?? ''} onChange={set('intro')} {...aria('intro')} />
          <span className="field-hint">최소 {INTRO_MIN}자 · {(values.intro ?? '').length}/{FORM_MAX.intro}</span>{err('intro')}
        </label>
        <label className={styles.field}>
          <span className="field-label">톤앤매너 (선택)</span>
          <input className={field('toneGuide')} maxLength={FORM_MAX.toneGuide} value={values.toneGuide ?? ''} onChange={set('toneGuide')} {...aria('toneGuide')} />
          {count('toneGuide')}{err('toneGuide')}
        </label>

        <div className={styles.field}>
          <label className="field-label" htmlFor="images">이미지 (jpg/png/webp, 10MB 이하)</label>
          <input id="images" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => void onFiles(e)} />
          <span className="field-hint">이번에 올린 이미지 {uploads.filter((u) => u.state === 'done').length}/{MAX_IMAGES}장</span>
          <ul className={styles.thumbs}>
            {uploads.map((u) => (
              <li key={u.key} className={styles.thumb}>
                <img src={u.url} alt={u.name} />
                {u.state === 'uploading' && <span className="spinner" role="status" aria-label="업로드 중" />}
                {u.state === 'done' && <span className="field-hint">완료</span>}
                {u.state === 'error' && <span className="field-error" role="alert">{u.error}</span>}
              </li>
            ))}
          </ul>
        </div>

        {message && <p className="field-error" role="alert">{message}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(() => undefined)}>저장</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run((pid) => void navigate(`/app/projects/${pid}/analyze`))}>분석하기</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void run((pid) => void navigate(`/app/projects/${pid}/edit`, { state: { generate: true } }), true)}>분석 없이 생성</button>
        </div>
      </form>
    </main>
  )
}
