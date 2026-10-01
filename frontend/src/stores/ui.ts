import { create } from 'zustand'

export type ToastMsg = { text: string; tone: 'info' | 'warn' | 'success' | 'error' }

type UiState = {
  selectedBlockId: string | null
  modal: 'publish' | null
  toast: ToastMsg | null
  selectBlock: (id: string | null) => void
  setModal: (modal: 'publish' | null) => void
  setToast: (toast: ToastMsg | null) => void
}

export const useUiStore = create<UiState>()((set) => ({
  selectedBlockId: null,
  modal: null,
  toast: null,
  selectBlock: (selectedBlockId) => set({ selectedBlockId }),
  setModal: (modal) => set({ modal }),
  setToast: (toast) => set({ toast }),
}))
