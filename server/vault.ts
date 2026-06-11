/**
 * API key 加密保管 —— AES-256-GCM
 *
 * 主密钥来源（按优先级）：
 *   1. 环境变量 KEY_ENCRYPTION_KEY（64 位 hex = 32 字节，生产用这个）
 *   2. server/data/.master-key 文件（不存在则自动生成，开发方便）
 *
 * 密文格式：iv.tag.ciphertext（各自 base64，点号分隔）。
 * 换主密钥 = 旧密文全部作废，务必备份。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let cached: Buffer | null = null

async function masterKey(): Promise<Buffer> {
  if (cached) return cached
  const env = process.env.KEY_ENCRYPTION_KEY?.trim()
  if (env) {
    if (!/^[0-9a-fA-F]{64}$/.test(env)) throw new Error('KEY_ENCRYPTION_KEY 必须是 64 位 hex（32 字节）')
    cached = Buffer.from(env, 'hex')
    return cached
  }
  const file = join(__dirname, 'data', '.master-key')
  try {
    const hex = (await readFile(file, 'utf-8')).trim()
    if (/^[0-9a-fA-F]{64}$/.test(hex)) { cached = Buffer.from(hex, 'hex'); return cached }
  } catch { /* 不存在 → 生成 */ }
  const key = randomBytes(32)
  await writeFile(file, key.toString('hex'), { mode: 0o600 })
  cached = key
  return key
}

export async function encryptSecret(plain: string): Promise<string> {
  const key = await masterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.')
}

export async function decryptSecret(stored: string): Promise<string> {
  const key = await masterKey()
  const [iv, tag, enc] = stored.split('.').map((s) => Buffer.from(s, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
