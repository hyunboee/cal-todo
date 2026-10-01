export type ProjectStatus = 'DRAFT' | 'ANALYZED' | 'GENERATED' | 'EDITING' | 'PUBLISHED'
export type JobType = 'ANALYZE' | 'GENERATE' | 'REGEN' | 'AI_EDIT'
export type ProjectForm = { productName?: string; category?: string; intro?: string; toneGuide?: string }
export type Project = {
  id: string; status: ProjectStatus; version: number; form: ProjectForm; selectedUsps: string[]
  analyzeCount: number; regenCount: number; aiEditCount: number; aiEditFailCount: number
  activeJobType: JobType | null; activeJobStartedAt: string | null; publishedAt: string | null; createdAt: string
}
export type Me = { email: string; emailVerified: boolean; balance: number }
export type Credentials = { email: string; password: string }
export type TokenResponse = { accessToken: string; expiresIn: number }
export type PreviewBlock = { blockId: string; fields: { editId: string; text: string }[] }
export type Preview = { version: number; html: string; blocks: PreviewBlock[] }
export type AssetUploadResult = { id: string }
