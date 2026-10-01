import { request } from './client.ts'
import type { AssetUploadResult, Preview, Project, ProjectForm } from './types.ts'

export const listProjects = () => request<Project[]>('/projects')
export const getProject = (id: string) => request<Project>(`/projects/${id}`, { projectId: id })
export const createProject = (form: ProjectForm) => request<Project>('/projects', { method: 'POST', json: { form } })
export const saveForm = (id: string, form: ProjectForm, version: number) =>
  request<Project>(`/projects/${id}/form`, { method: 'PUT', json: { form, version }, projectId: id })
export function uploadAsset(id: string, file: Blob): Promise<AssetUploadResult> {
  const fd = new FormData()
  fd.append('file', file)
  return request<AssetUploadResult>(`/projects/${id}/assets`, { method: 'POST', form: fd, projectId: id })
}
export const generate = (id: string, version: number) =>
  request<Preview>(`/projects/${id}/generate`, { method: 'POST', json: { version }, projectId: id })
export const getPreview = (id: string) => request<Preview>(`/projects/${id}/preview`, { projectId: id })
