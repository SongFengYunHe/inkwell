const ENC_PREFIX = 'enc:'
const PLAIN_PREFIX = 'plain:'

/** Electron safeStorage 的最小接口（避免 security 层直接依赖 electron，供 MCP 独立进程复用） */
export interface SecretCrypto {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

let crypto: SecretCrypto | null = null

/**
 * 由 Electron 主进程注入 safeStorage。
 * MCP Server 等独立运行时不会注入：此时加密降级为 base64 明文标注，
 * 且无法解开桌面端写入的 `enc:` 密钥（属预期行为，不影响落盘与写作）。
 */
export function setSecretCrypto(impl: SecretCrypto | null): void {
  crypto = impl
}

/**
 * 加密密钥后落库。优先使用 Electron safeStorage（Windows DPAPI / macOS Keychain），
 * 不可用时降级为 base64 并显式标注，便于日后识别与迁移。
 */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (crypto?.isEncryptionAvailable()) {
    return ENC_PREFIX + crypto.encryptString(plain).toString('base64')
  }
  return PLAIN_PREFIX + Buffer.from(plain, 'utf8').toString('base64')
}

/** 解密密钥；格式无法识别或运行时不支持时返回空串，绝不抛错打断生成流程 */
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  try {
    if (stored.startsWith(ENC_PREFIX)) {
      if (!crypto) return ''
      return crypto.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    }
    if (stored.startsWith(PLAIN_PREFIX)) {
      return Buffer.from(stored.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')
    }
  } catch {
    return ''
  }
  return ''
}