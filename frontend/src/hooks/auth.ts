import { useMutation, useQuery } from '@tanstack/react-query'
import { getMe, login, logout, signup } from '../api/auth.ts'
import { resetAuth } from '../api/client.ts'
import type { ApiError } from '../api/client.ts'
import type { Credentials, Me, TokenResponse } from '../api/types.ts'
import { useAuthStore } from '../stores/auth.ts'

export function useMe() {
  const token = useAuthStore((s) => s.accessToken)
  return useQuery<Me, ApiError>({ queryKey: ['me'], queryFn: getMe, enabled: !!token })
}

const saveToken = (t: TokenResponse) => useAuthStore.getState().setAccessToken(t.accessToken)

export const useLogin = () =>
  useMutation<TokenResponse, ApiError, Credentials>({ mutationFn: login, onSuccess: saveToken })

export const useSignup = () =>
  useMutation<TokenResponse, ApiError, Credentials>({ mutationFn: signup, onSuccess: saveToken })

export const useLogout = () =>
  useMutation<void, ApiError, void>({ mutationFn: logout, onSettled: resetAuth })
