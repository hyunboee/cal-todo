import { request } from './client.ts'
import type { Preview } from './types.ts'

export type EditInput = { blockId: string; editId: string; text: string }
export type FinalHtml = { finalHtml: string }

export const saveEdit = (id: string, input: EditInput, version: number) =>
  request<Preview>(`/projects/${id}/edits`, { method: 'POST', json: { ...input, version }, projectId: id })
export const regenerate = (id: string, version: number) =>
  request<Preview>(`/projects/${id}/regenerate`, { method: 'POST', json: { version }, projectId: id })
export const publish = (id: string, version: number) =>
  request<FinalHtml>(`/projects/${id}/publish`, { method: 'POST', json: { version }, projectId: id })
export const getFinal = (id: string) => request<FinalHtml>(`/projects/${id}/final`, { projectId: id })
