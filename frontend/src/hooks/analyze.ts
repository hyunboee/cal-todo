import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { analyze, saveUsps } from '../api/analyze.ts'
import type { AnalysisResult } from '../api/analyze.ts'
import type { ApiError } from '../api/client.ts'
import type { Project } from '../api/types.ts'
import { currentVersion } from './projects.ts'

// 분석 결과 조회 API가 없어 POST 응답을 메모리 캐시에만 둔다
export const useAnalysis = (id: string | undefined) =>
  useQuery<AnalysisResult, ApiError>({ queryKey: ['analysis', id], queryFn: skipToken, gcTime: Infinity })

export function useAnalyze(id: string) {
  const qc = useQueryClient()
  return useMutation<AnalysisResult, ApiError, string>({
    mutationKey: ['analyze', id],
    mutationFn: (url) => analyze(id, url, currentVersion(qc, id)),
    onSuccess: (a) => qc.setQueryData(['analysis', id], a),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['project', id] }),
  })
}

export function useSaveUsps(id: string) {
  const qc = useQueryClient()
  return useMutation<Project, ApiError, string[]>({
    mutationFn: (usps) => saveUsps(id, usps, currentVersion(qc, id)),
    onSuccess: (p) => {
      qc.setQueryData(['project', id], p)
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
