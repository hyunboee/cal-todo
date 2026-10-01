import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiError } from '../api/client.ts'
import { getFinal, publish, regenerate, saveEdit } from '../api/editor.ts'
import type { EditInput, FinalHtml } from '../api/editor.ts'
import type { Preview } from '../api/types.ts'
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
