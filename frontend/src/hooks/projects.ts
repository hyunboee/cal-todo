import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/client.ts'
import { createProject, generate, getPreview, getProject, listProjects, saveForm, uploadAsset } from '../api/projects.ts'
import type { AssetUploadResult, Preview, Project, ProjectForm } from '../api/types.ts'

export const JOB_POLL_MS = 3000 // [가정]

export const useProjects = () =>
  useQuery<Project[], ApiError>({ queryKey: ['projects'], queryFn: listProjects })

export const useProject = (id: string | undefined) =>
  useQuery<Project, ApiError>({
    queryKey: ['project', id],
    queryFn: () => getProject(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.activeJobType ? JOB_POLL_MS : false),
  })

export const usePreview = (id: string | undefined, version: number | undefined, enabled: boolean) =>
  useQuery<Preview, ApiError>({
    queryKey: ['preview', id, version],
    queryFn: () => getPreview(id!),
    enabled: enabled && !!id && version !== undefined,
  })

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation<Project, ApiError, ProjectForm>({
    mutationFn: createProject,
    onSuccess: (p) => {
      qc.setQueryData(['project', p.id], p)
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

// 실행 시점 캐시의 version을 사용한다(409 후 갱신된 값 반영)
export function currentVersion(qc: ReturnType<typeof useQueryClient>, id: string): number {
  return qc.getQueryData<Project>(['project', id])?.version ?? 0
}

export function useSaveForm() {
  const qc = useQueryClient()
  return useMutation<Project, ApiError, { id: string; form: ProjectForm }>({
    mutationFn: ({ id, form }) => saveForm(id, form, currentVersion(qc, id)),
    onSuccess: (p) => qc.setQueryData(['project', p.id], p),
  })
}

export const useUploadAsset = () =>
  useMutation<AssetUploadResult, ApiError, { id: string; file: File }>({
    mutationFn: ({ id, file }) => uploadAsset(id, file),
  })

export function useGenerate(id: string) {
  const qc = useQueryClient()
  return useMutation<Preview, ApiError, void>({
    mutationKey: ['generate', id],
    mutationFn: () => generate(id, currentVersion(qc, id)),
    onSuccess: (pv) => {
      qc.setQueryData(['preview', id, pv.version], pv)
      void qc.invalidateQueries({ queryKey: ['project', id] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['project', id] }),
  })
}
