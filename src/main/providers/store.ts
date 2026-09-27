import type { Provider, ProviderKind, ProviderSaveInput } from '@shared/types'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { provider } from '../db/schema'
import { decryptSecret, encryptSecret } from '../security/secrets'

type ProviderRow = typeof provider.$inferSelect

/** 请求头只允许少量合法键值，避免用户误填导致请求被拒 */
export function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const name = key.trim()
    if (!name || typeof value !== 'string') continue
    result[name] = value
    if (Object.keys(result).length >= 30) break
  }
  return result
}

function toDto(row: ProviderRow): Provider {
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled,
    hasApiKey: row.apiKeyEnc.length > 0,
    headers: row.headers ?? {},
    rateLimitPerMin: row.rateLimitPerMin,
    riskAccepted: row.riskAccepted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function listProviders(): Provider[] {
  return getDb().select().from(provider).orderBy(asc(provider.id)).all().map(toDto)
}

/** 保存接入配置；`apiKey` 留空表示保持原密钥不变 */
export function saveProvider(input: ProviderSaveInput): Provider {
  const db = getDb()
  const now = Date.now()

  if (input.id) {
    const patch: Partial<typeof provider.$inferInsert> = {
      kind: input.kind ?? 'openai-compatible',
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      updatedAt: now
    }
    if (input.enabled !== undefined) patch.enabled = input.enabled
    if (input.apiKey) patch.apiKeyEnc = encryptSecret(input.apiKey)
    if (input.headers !== undefined) patch.headers = sanitizeHeaders(input.headers)
    if (input.rateLimitPerMin !== undefined) patch.rateLimitPerMin = Math.max(0, Math.floor(input.rateLimitPerMin))
    if (input.riskAccepted !== undefined) patch.riskAccepted = input.riskAccepted

    const row = db.update(provider).set(patch).where(eq(provider.id, input.id)).returning().get()
    if (!row) throw new Error(`接入配置不存在：${input.id}`)
    return toDto(row)
  }

  const row = db
    .insert(provider)
    .values({
      kind: input.kind ?? 'openai-compatible',
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyEnc: input.apiKey ? encryptSecret(input.apiKey) : '',
      enabled: input.enabled ?? true,
      headers: sanitizeHeaders(input.headers),
      rateLimitPerMin: Math.max(0, Math.floor(input.rateLimitPerMin ?? 0)),
      riskAccepted: input.riskAccepted ?? false,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()
  return toDto(row)
}

export function deleteProvider(id: number): void {
  getDb().delete(provider).where(eq(provider.id, id)).run()
}

/** 取已有配置的明文密钥，用于「测试连接」时表单密钥留空的情形 */
export function getProviderSecret(id: number): string {
  const row = getDb().select().from(provider).where(eq(provider.id, id)).get()
  return row ? decryptSecret(row.apiKeyEnc) : ''
}

/** 按 id 取配置（含明文密钥），供路由与连接测试使用 */
export function getProviderById(id: number): { dto: Provider; apiKey: string } | null {
  const row = getDb().select().from(provider).where(eq(provider.id, id)).get()
  if (!row) return null
  return { dto: toDto(row), apiKey: decryptSecret(row.apiKeyEnc) }
}

/** 当前启用的接入配置（取第一个启用的；未配置路由时的兜底选择） */
export function getActiveProvider(): { dto: Provider; apiKey: string } | null {
  const row = getDb().select().from(provider).where(eq(provider.enabled, true)).orderBy(asc(provider.id)).get()
  if (!row) return null
  return { dto: toDto(row), apiKey: decryptSecret(row.apiKeyEnc) }
}