import { create } from 'zustand'
import type { ImageRef } from '../api/editor.ts'

export type ToastMsg = { text: string; tone: 'info' | 'warn' | 'success' | 'error' }

type Modal = 'publish' | 'images' | null

type UiState = {
  selectedBlockId: string | null
  selectedImage: ImageRef | null
  modal: Modal
  toast: ToastMsg | null
  selectBlock: (id: string | null) => void
  selectImage: (ref: ImageRef | null) => void
  setModal: (modal: Modal) => void
  setToast: (toast: ToastMsg | null) => void
}

export const useUiStore = create<UiState>()((set) => ({
  selectedBlockId: null,
  selectedImage: null,
  modal: null,
  toast: null,
  selectBlock: (selectedBlockId) => set({ selectedBlockId }),
  selectImage: (selectedImage) => set({ selectedImage }),
  setModal: (modal) => set({ modal }),
  setToast: (toast) => set({ toast }),
}))
