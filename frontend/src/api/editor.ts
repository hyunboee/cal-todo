import { request } from './client.ts'
import type { Preview, ProjectAsset } from './types.ts'

export type EditInput = { blockId: string; editId: string; text: string }
export type FinalHtml = { finalHtml: string }

export const saveEdit = (id: string, input: EditInput, version: number) =>
  request<Preview>(`/projects/${id}/edits`, { method: 'POST', json: { ...input, version }, projectId: id })
export const regenerate = (id: string, version: number) =>
  request<Preview>(`/projects/${id}/regenerate`, { method: 'POST', json: { version }, projectId: id })
export const publish = (id: string, version: number) =>
  request<FinalHtml>(`/projects/${id}/publish`, { method: 'POST', json: { version }, projectId: id })
export const getFinal = (id: string) => request<FinalHtml>(`/projects/${id}/final`, { projectId: id })

export type ImageRef = { blockId: string; imageId: string }
export type ImageEditInput = ImageRef & { assetId: string }
export type AiImageInput = ImageRef & { prompt: string }
export const listAssets = (id: string) => request<ProjectAsset[]>(`/projects/${id}/assets`, { projectId: id })
export const saveImageEdit = (id: string, input: ImageEditInput, version: number) =>
  request<Preview>(`/projects/${id}/image-edits`, { method: 'POST', json: { ...input, version }, projectId: id })
export const aiImage = (id: string, input: AiImageInput, version: number) =>
  request<Preview>(`/projects/${id}/ai-images`, { method: 'POST', json: { ...input, version }, projectId: id })

export type ImageAlign = 'left' | 'center' | 'right'
export type ImageStyleInput = ImageRef & { widthPct: number; align: ImageAlign }
export const blockRegenerate = (id: string, blockId: string, version: number) =>
  request<Preview>(`/projects/${id}/block-regenerate`, { method: 'POST', json: { blockId, version }, projectId: id })
export const saveImageStyle = (id: string, input: ImageStyleInput, version: number) =>
  request<Preview>(`/projects/${id}/image-styles`, { method: 'POST', json: { ...input, version }, projectId: id })
