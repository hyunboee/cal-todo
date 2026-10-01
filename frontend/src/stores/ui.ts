import { create } from 'zustand'

type UiState = {
  selectedBlockId: string | null
  modal: 'publish' | null
  toast: string | null
  selectBlock: (id: string | null) => void
  setModal: (modal: 'publish' | null) => void
  setToast: (toast: string | null) => void
}

export const useUiStore = create<UiState>()((set) => ({
  selectedBlockId: null,
  modal: null,
  toast: null,
  selectBlock: (selectedBlockId) => set({ selectedBlockId }),
  setModal: (modal) => set({ modal }),
  setToast: (toast) => set({ toast }),
}))
