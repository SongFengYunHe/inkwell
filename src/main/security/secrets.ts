import { safeStorage } from 'electron'

const ENC_PREFIX = 'enc:'
const PLAIN_PREFIX = 'plain:'

/**
 * 加密密钥后落库。优先使用 Electron safeStorage（Windows DPAPI / macOS Keychain），
 * 不可用时降级为 base64 并显式标注，便于日后识别与迁移。
 */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  }
  return PLAIN_PREFIX + Buffer.from(plain, 'utf8').toString('base64')
}

/** 解密密钥；格式无法识别时返回空串，绝不抛错打断生成流程 */
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  try {
    if (stored.startsWith(ENC_PREFIX)) {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    }
    if (stored.startsWith(PLAIN_PREFIX)) {
      return Buffer.from(stored.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')
    }
  } catch {
    return ''
  }
  return ''
}