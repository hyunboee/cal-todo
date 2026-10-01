import { create } from 'zustand'

type AuthState = {
  accessToken: string | null
  setAccessToken: (token: string) => void
  clear: () => void
}

// 메모리에만 보관한다(LY-11)
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null }),
}))
