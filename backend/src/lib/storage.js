import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import {
  STORAGE_DRIVER, STORAGE_LOCAL_DIR, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
  S3_PRIVATE_BUCKET, S3_PUBLIC_BUCKET,
} from '../config.js'

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// 키 형식. 원본·프리뷰는 비공개 버킷, 공개 키는 추측 불가한 asset id에서 결정적으로 만든다(재시도 시 저장 불필요)
export const assetKeys = (projectId, assetId, mime) => ({
  original: `orig/${projectId}/${assetId}.${EXT[mime]}`,
  preview: `prev/${projectId}/${assetId}.webp`,
})
export const publicKey = (assetId, mime) => `${assetId}.${EXT[mime]}`

const s3 = STORAGE_DRIVER === 's3'
  ? new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    forcePathStyle: true, // Supabase Storage(S3 호환)는 path-style만 지원. R2도 지원
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  })
  : null
const BUCKETS = { private: S3_PRIVATE_BUCKET, public: S3_PUBLIC_BUCKET }

const s3Storage = {
  async put(bucket, key, body, contentType) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKETS[bucket], Key: key, Body: body, ContentType: contentType }))
  },
  async get(bucket, key) {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKETS[bucket], Key: key }))
    return Buffer.from(await r.Body.transformToByteArray())
  },
  async copy(fromBucket, fromKey, toBucket, toKey) {
    await s3.send(new CopyObjectCommand({ CopySource: `${BUCKETS[fromBucket]}/${fromKey}`, Bucket: BUCKETS[toBucket], Key: toKey }))
  },
}

// 키는 서버가 uuid로 만든다(사용자 입력 아님)
const localPath = (bucket, key) => join(STORAGE_LOCAL_DIR, bucket, key)
const ensureDir = (path) => mkdir(dirname(path), { recursive: true })

const localStorage = {
  async put(bucket, key, body) {
    const path = localPath(bucket, key)
    await ensureDir(path)
    await writeFile(path, body)
  },
  get: (bucket, key) => readFile(localPath(bucket, key)),
  async copy(fromBucket, fromKey, toBucket, toKey) {
    const path = localPath(toBucket, toKey)
    await ensureDir(path)
    await copyFile(localPath(fromBucket, fromKey), path)
  },
}

// bucket: 'private' | 'public'. 호출은 항상 storage.method(...)로(테스트가 메서드를 교체한다, QA-04)
export const storage = STORAGE_DRIVER === 's3' ? s3Storage : localStorage
