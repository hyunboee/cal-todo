import { request } from './client.ts'
import type { Credentials, Me, TokenResponse } from './types.ts'

export const signup = (c: Credentials) => request<TokenResponse>('/auth/signup', { method: 'POST', json: c })
export const login = (c: Credentials) => request<TokenResponse>('/auth/login', { method: 'POST', json: c })
export const logout = () => request<void>('/auth/logout', { method: 'POST' })
export const getMe = () => request<Me>('/me')
