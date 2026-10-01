import type { ChatChunk, ChatProvider, ChatRequest, EmbedRequest, EmbedResponse } from './types'
import type { ProviderTestResult } from '@shared/types'

export interface OpenAiCompatibleConfig {
  id: string
  baseUrl: string
  apiKey: string
  /** 连接测试用的默认模型；正式生成时以 ChatRequest.model 为准 */
  model?: string
  /** 自定义请求头（部分自建 / 第三方端点需要） */
  headers?: Record<string, string>
}

/** 允许用户直接填到 /chat/completions，也允许只填到 /v1 */
function resolveChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

/** embeddings 地址：兼容用户把 baseUrl 填成 /chat/completions 的情况 */
function resolveEmbeddingsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
  if (/\/embeddings$/i.test(trimmed)) return trimmed
  return `${trimmed}/embeddings`
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 从 SSE 的 data 载荷里取出增量文本与（可选的）用量 */
function extractChunk(payload: string): ChatChunk | null {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const choice = parsed.choices?.[0]
    const delta = choice?.delta?.content ?? choice?.message?.content ?? ''
    const usage = parsed.usage
      ? {
          promptTokens: parsed.usage.prompt_tokens ?? 0,
          completionTokens: parsed.usage.completion_tokens ?? 0
        }
      : undefined

    if (!delta && !usage) return null
    return usage ? { delta, usage } : { delta }
  } catch {
    return null
  }
}

/** OpenAI 兼容协议实现（官方 API / 中转 / 本地 Ollama 均可） */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly id: string
  private readonly config: OpenAiCompatibleConfig

  constructor(config: OpenAiCompatibleConfig) {
    this.config = config
    this.id = config.id
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...this.config.headers }
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`
    return headers
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const response = await fetch(resolveChatUrl(this.config.baseUrl), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: request.temperature ?? 0.85,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {})
      }),
      signal
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`模型接口返回 HTTP ${response.status}：${truncate(detail, 300)}`)
    }
    if (!response.body) throw new Error('模型接口未返回流式响应体')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')

          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            await reader.cancel().catch(() => undefined)
            return
          }
          const delta = extractChunk(payload)
          if (delta) yield delta
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * A3：OpenAI 兼容的 /embeddings。
   * 注意：并非所有"OpenAI 兼容"端点都提供 embeddings（很多中转只做 chat），
   * 因此这里失败要给出明确文案，让上层把向量检索当作「不可用」而非崩溃。
   */
  async embed(request: EmbedRequest, signal?: AbortSignal): Promise<EmbedResponse> {
    const response = await fetch(resolveEmbeddingsUrl(this.config.baseUrl), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: request.model, input: request.input }),
      signal
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `该端点不支持 embedding（HTTP ${response.status}）：${truncate(detail, 200)}。` +
          '请在「设置 · 角色路由」里为「向量（embedder）」单独指定一个支持 embeddings 的端点。'
      )
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>
      usage?: { prompt_tokens?: number }
    }
    const vectors = (payload.data ?? []).map((item) => item.embedding ?? [])
    if (vectors.length !== request.input.length || vectors.some((vector) => vector.length === 0)) {
      throw new Error('端点返回的 embedding 数量或维度不符合预期')
    }
    return { vectors, promptTokens: payload.usage?.prompt_tokens }
  }

  async health(signal?: AbortSignal): Promise<ProviderTestResult> {
    const started = Date.now()
    try {
      const response = await fetch(resolveChatUrl(this.config.baseUrl), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.model ?? '',
          messages: [{ role: 'user', content: '你好' }],
          max_tokens: 1,
          stream: false
        }),
        signal
      })
      const latencyMs = Date.now() - started
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        return { ok: false, message: `HTTP ${response.status}：${truncate(detail, 200)}`, latencyMs }
      }
      await response.body?.cancel().catch(() => undefined)
      return { ok: true, message: '连接正常', latencyMs }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started
      }
    }
  }
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): ChatProvider {
  return new OpenAiCompatibleProvider(config)
}