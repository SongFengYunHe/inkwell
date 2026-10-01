import { createOpenAiCompatibleProvider } from '../providers/openai-compatible'
import { resolveTargets } from './route'
import { recordLlmCall } from './usage'

/**
 * A3 向量检索的 embedding 调用。
 * 复用「角色 → 端点」路由（embedder 角色），与写作调用同一套接入配置与用量记账。
 */

/** 单次请求的最大文本条数（多数端点上限 2048，取一个保守值） */
const MAX_BATCH = 32
/** 单条文本最大字符数 */
const MAX_CHARS = 2_000

export interface EmbedResult {
  vectors: number[][]
  model: string
  providerName: string
}

/** 是否配置了可用的 embedder 端点 */
export function embedderConfigured(): boolean {
  try {
    return resolveTargets('embedder').length > 0
  } catch {
    return false
  }
}

function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return Math.max(1, Math.round(cjk + (text.length - cjk) / 4))
}

/**
 * 批量取向量。过长文本会被截断；不足一批的按实际条数请求。
 * 端点未配置 embedding 能力时会抛出可读错误，调用方按「不可用」处理即可。
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<EmbedResult> {
  const cleaned = texts.map((text) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS))
  if (cleaned.length === 0) return { vectors: [], model: '', providerName: '' }

  const targets = resolveTargets('embedder')
  if (targets.length === 0) {
    throw new Error('尚未为「向量（embedder）」角色配置模型端点，无法做向量检索')
  }

  const vectors: number[][] = []
  let model = ''
  let providerName = ''

  for (let start = 0; start < cleaned.length; start += MAX_BATCH) {
    const batch = cleaned.slice(start, start + MAX_BATCH)
    let lastError: Error | null = null

    for (const target of targets) {
      const startedAt = Date.now()
      try {
        const provider = createOpenAiCompatibleProvider({
          id: String(target.providerId),
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          model: target.model,
          headers: target.headers
        })
        if (!provider.embed) throw new Error('当前端点实现不支持 embedding')
        const result = await provider.embed({ model: target.model, input: batch }, signal)
        recordLlmCall({
          providerId: target.providerId,
          providerName: target.providerName,
          model: target.model,
          role: 'embedder',
          promptTokens: result.promptTokens ?? batch.reduce((sum, text) => sum + estimateTokens(text), 0),
          completionTokens: 0,
          durationMs: Date.now() - startedAt,
          success: true,
          error: '',
          createdAt: Date.now()
        })
        vectors.push(...result.vectors)
        model = target.model
        providerName = target.providerName
        lastError = null
        break
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        recordLlmCall({
          providerId: target.providerId,
          providerName: target.providerName,
          model: target.model,
          role: 'embedder',
          promptTokens: 0,
          completionTokens: 0,
          durationMs: Date.now() - startedAt,
          success: false,
          error: lastError.message,
          createdAt: Date.now()
        })
        if (signal?.aborted) throw lastError
      }
    }

    if (lastError) throw lastError
  }

  return { vectors, model, providerName }
}
