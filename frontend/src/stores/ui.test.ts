import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useUiStore } from './ui.ts'

describe('useUiStore', () => {
  beforeEach(() => useUiStore.setState({ selectedBlockId: null, selectedImage: null, modal: null, toast: null }))

  it('초기값은 모두 null', () => {
    const s = useUiStore.getState()
    assert.equal(s.selectedBlockId, null)
    assert.equal(s.selectedImage, null)
    assert.equal(s.modal, null)
    assert.equal(s.toast, null)
  })

  it('selectBlock → 선택·해제', () => {
    useUiStore.getState().selectBlock('b1')
    assert.equal(useUiStore.getState().selectedBlockId, 'b1')
    useUiStore.getState().selectBlock(null)
    assert.equal(useUiStore.getState().selectedBlockId, null)
  })

  it('setModal → publish 열기·닫기', () => {
    useUiStore.getState().setModal('publish')
    assert.equal(useUiStore.getState().modal, 'publish')
    useUiStore.getState().setModal(null)
    assert.equal(useUiStore.getState().modal, null)
  })

  it('selectImage → 선택·해제', () => {
    useUiStore.getState().selectImage({ blockId: 'b1', imageId: 'i1' })
    assert.deepEqual(useUiStore.getState().selectedImage, { blockId: 'b1', imageId: 'i1' })
    useUiStore.getState().selectImage(null)
    assert.equal(useUiStore.getState().selectedImage, null)
  })

  it('setModal → images 열기·닫기', () => {
    useUiStore.getState().setModal('images')
    assert.equal(useUiStore.getState().modal, 'images')
    useUiStore.getState().setModal(null)
    assert.equal(useUiStore.getState().modal, null)
  })

  it('setToast → 메시지 표시·제거', () => {
    useUiStore.getState().setToast({ text: '저장됨', tone: 'success' })
    assert.deepEqual(useUiStore.getState().toast, { text: '저장됨', tone: 'success' })
    useUiStore.getState().setToast(null)
    assert.equal(useUiStore.getState().toast, null)
  })
})
