import type { Me, Project, ProjectForm } from './api/types.ts'

export const REGEN_MAX = 3 // D-5
export const FORM_MAX = { productName: 100, category: 50, intro: 1000, toneGuide: 200 } as const // backend config.js FORM_LIMITS와 동일
export const INTRO_MIN = 10

export function projectPath(p: Pick<Project, 'id' | 'status'>): string {
  const base = `/app/projects/${p.id}`
  if (p.status === 'DRAFT' || p.status === 'ANALYZED') return `${base}/form`
  if (p.status === 'PUBLISHED') return `${base}/final`
  return `${base}/edit`
}

export function isEligible(me: Me | undefined): boolean {
  return !!me && me.emailVerified && me.balance > 0
}

export type EditorFlags = { generate: boolean; regenerate: boolean; save: boolean; publish: boolean }

export function editorFlags(p: Project, me: Me | undefined, pending: boolean): EditorFlags {
  const ok = isEligible(me) && !pending && p.activeJobType === null
  const none = { generate: false, regenerate: false, save: false, publish: false }
  if (p.status === 'DRAFT' || p.status === 'ANALYZED') return { ...none, generate: ok }
  if (p.status === 'GENERATED' || p.status === 'EDITING') {
    return { generate: false, regenerate: ok && p.regenCount < REGEN_MAX, save: ok, publish: ok }
  }
  return none
}

export function formatElapsed(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))}초`
}

export type FormErrors = Partial<Record<keyof ProjectForm, string>>

export function validateForm(f: ProjectForm): FormErrors {
  const e: FormErrors = {}
  const len = (k: keyof ProjectForm) => (f[k] ?? '').trim().length
  if (len('productName') < 1) e.productName = '제품명을 입력하세요'
  else if (len('productName') > FORM_MAX.productName) e.productName = `제품명은 ${FORM_MAX.productName}자 이하여야 합니다`
  if (len('category') < 1) e.category = '카테고리를 입력하세요'
  else if (len('category') > FORM_MAX.category) e.category = `카테고리는 ${FORM_MAX.category}자 이하여야 합니다`
  if (len('intro') < INTRO_MIN) e.intro = `소개글은 ${INTRO_MIN}자 이상 입력하세요`
  else if (len('intro') > FORM_MAX.intro) e.intro = `소개글은 ${FORM_MAX.intro}자 이하여야 합니다`
  if (len('toneGuide') > FORM_MAX.toneGuide) e.toneGuide = `톤앤매너는 ${FORM_MAX.toneGuide}자 이하여야 합니다`
  return e
}
