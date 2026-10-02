export type ProjectStatus = 'DRAFT' | 'ANALYZED' | 'GENERATED' | 'EDITING' | 'PUBLISHED'
export type JobType = 'ANALYZE' | 'GENERATE' | 'REGEN' | 'AI_EDIT' | 'AI_IMAGE' | 'BLOCK_REGEN'
export type ProjectForm = { productName?: string; category?: string; intro?: string; toneGuide?: string }
export type Project = {
  id: string; status: ProjectStatus; version: number; form: ProjectForm; selectedUsps: string[]
  analyzeCount: number; regenCount: number; aiEditCount: number; aiEditFailCount: number; aiImageCount: number; blockRegenCount: number
  activeJobType: JobType | null; activeJobStartedAt: string | null; publishedAt: string | null; createdAt: string
}
export type Me = { email: string; emailVerified: boolean; balance: number }
export type Credentials = { email: string; password: string }
export type TokenResponse = { accessToken: string; expiresIn: number }
export type PreviewImage = { imageId: string; assetId: string; widthPct: number; align: 'left' | 'center' | 'right' }
export type PreviewBlock = { blockId: string; fields: { editId: string; text: string }[]; images: PreviewImage[] }
export type Preview = { version: number; html: string; blocks: PreviewBlock[] }
export type AssetUploadResult = { id: string }
export type ProjectAsset = { id: string; thumbnail: string }
