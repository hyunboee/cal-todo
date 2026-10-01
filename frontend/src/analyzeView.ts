import type { AnalysisResult } from './api/analyze.ts'
import type { Me, Project } from './api/types.ts'
import { messageOf } from './messages.ts'
import { isEligible } from './projectView.ts'

export const ANALYZE_MAX = 3 // backend config.js ANALYZE_MAX (D-27)

export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

export function uspChoices(p: Pick<Project, 'status' | 'selectedUsps'>, analysis: AnalysisResult | undefined): string[] {
  if (analysis) return analysis.uspCandidates
  return p.status === 'ANALYZED' ? p.selectedUsps : []
}

export type AnalyzeFlags = { analyze: boolean; save: boolean; skip: boolean; generate: boolean }

export function analyzeFlags(p: Project, me: Me | undefined, s: { pending: boolean; url: string; selected: string[] }): AnalyzeFlags {
  const ok = isEligible(me) && !s.pending && p.activeJobType === null && (p.status === 'DRAFT' || p.status === 'ANALYZED')
  const dirty = !sameSet(s.selected, p.selectedUsps)
  return {
    analyze: ok && s.url.trim() !== '' && p.analyzeCount < ANALYZE_MAX,
    save: ok && s.selected.length > 0 && dirty,
    skip: ok && p.status === 'DRAFT',
    generate: ok && p.status === 'ANALYZED' && !dirty,
  }
}

export type AnalyzeErrorView = { urlError: string | null; crawlFailed: boolean; message: string | null }

export function analyzeErrorView(e: unknown): AnalyzeErrorView {
  const none = { urlError: null, crawlFailed: false, message: null }
  if (e === null || e === undefined) return none
  const status = (e as { status?: number }).status
  if (status === 400) return { ...none, urlError: '쿠팡 상품 URL 형식이 아닙니다 (https://www.coupang.com/vp/products/숫자)' }
  if (status === 502) return { ...none, crawlFailed: true, message: '경쟁사 페이지를 분석하지 못했습니다. 분석 없이 바로 생성할 수 있습니다' }
  if (status === 409 || status === 429) return none
  return { ...none, message: messageOf(e) }
}
