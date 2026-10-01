import { request } from './client.ts'
import type { Project } from './types.ts'

export type AnalysisResult = { sourceUrl: string; uspCandidates: string[]; analyzedAt: string }

export const analyze = (id: string, url: string, version: number) =>
  request<AnalysisResult>(`/projects/${id}/analyze`, { method: 'POST', json: { url, version }, projectId: id })
export const saveUsps = (id: string, selectedUsps: string[], version: number) =>
  request<Project>(`/projects/${id}/usps`, { method: 'PUT', json: { selectedUsps, version }, projectId: id })
