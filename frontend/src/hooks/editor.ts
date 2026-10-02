import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/client.ts'
import { aiImage, blockRegenerate, getFinal, listAssets, publish, regenerate, saveEdit, saveImageEdit, saveImageStyle } from '../api/editor.ts'
import type { AiImageInput, EditInput, FinalHtml, ImageEditInput, ImageStyleInput } from '../api/editor.ts'
import type { Preview, ProjectAsset } from '../api/types.ts'
import { currentVersion } from './projects.ts'

type QC = ReturnType<typeof useQueryClient>

function afterPreview(qc: QC, id: string, pv: Preview) {
  qc.setQueryData(['preview', id, pv.version], pv)
  void qc.invalidateQueries({ queryKey: ['project', id] })
  void qc.invalidateQueries({ queryKey: ['projects'] })
}

export function useSaveEdit(id: string) {
  const qc = useQueryClient()
  return useMutation<Preview, ApiError, EditInput>({
    mutationFn: (input) => saveEdit(id, input, currentVersion(qc, id)),
    onSuccess: (pv) => afterPreview(qc, id, pv),
  })
}

export function useImageEdit(id: string) {
  const qc = useQueryClient()
  return useMutation<Preview, ApiError, ImageEditInput>({
    mutationFn: (input) => saveImageEdit(id, input, currentVersion(qc, id)),
    onSuccess: (pv) => afterPreview(qc, id, pv),
  })
}

export function useAiImage(id: string) {
  const qc = useQueryClient()
  return useMutation<Preview, ApiError, AiImageInput>({
    mutationKey: ['ai-image', id],
    mutationFn: (input) => aiImage(id, input, currentVersion(qc, id)),
    onSuccess: (pv) => {
      afterPreview(qc, id, pv)
      void qc.invalidateQueries({ queryKey: ['assets', id] })
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['project', id] }),
  })
}

export function useBlockRegenerate(id: string) {
  const qc = useQueryClient()
  return useMutation<Preview, ApiError, string>({
    mutationKey: ['block-regen', id],
    mutationFn: (blockId) => blockRegenerate(id, blockId, currentVersion(qc, id)),
    onSuccess: (pv) => afterPreview(qc, id, pv),
    onError: () => void qc.invalidateQueries({ queryKey: ['project', id] }),
  })
}

export function useImageStyle(id: string) {
  const qc = useQueryClient()
  return useMutation<Preview, ApiError, ImageStyleInput>({
    mutationFn: (input) => saveImageStyle(id, input, currentVersion(qc, id)),
    onSuccess: (pv) => afterPreview(qc, id, pv),
  })
}

export const useAssets = (id: string | undefined) =>
  useQuery<ProjectAsset[], ApiError>({ queryKey: ['assets', id], queryFn: () => listAssets(id!), enabled: !!id })

export function useRegenerate(id: string) {
  const qc = useQueryClient()
  return useMutation<Preview, ApiError, void>({
    mutationKey: ['regenerate', id],
    mutationFn: () => regenerate(id, currentVersion(qc, id)),
    onSuccess: (pv) => afterPreview(qc, id, pv),
    onError: () => void qc.invalidateQueries({ queryKey: ['project', id] }),
  })
}

export function usePublish(id: string) {
  const qc = useQueryClient()
  return useMutation<FinalHtml, ApiError, void>({
    mutationKey: ['publish', id],
    mutationFn: () => publish(id, currentVersion(qc, id)),
    onSuccess: (r) => {
      qc.setQueryData(['final', id], r)
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['project', id] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export const useFinal = (id: string | undefined) =>
  useQuery<FinalHtml, ApiError>({ queryKey: ['final', id], queryFn: () => getFinal(id!), enabled: !!id })
