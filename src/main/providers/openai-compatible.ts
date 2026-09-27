import type { ChatChunk, ChatProvider, ChatRequest } from './types'
import type { ProviderTestResult } from '@shared/types'

export interface OpenAiCompatibleConfig {
  id: string
  baseUrl: string
  apiKey: string
  /** 连接测试用的默认模型；正式生成时以 ChatRequest.model 为准 */
  model?: string
}

/** 允许用户直接填到 /chat/completions，也允许只填到 /v1 */
function resolveChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 从 SSE 的 data 载荷里取出增量文本 */
function extractDelta(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
    }
    const choice = parsed.choices?.[0]
    return choice?.delta?.content ?? choice?.message?.content ?? ''
  } catch {
    return ''
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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
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
          const delta = extractDelta(payload)
          if (delta) yield { delta }
        }
      }
    } finally {
      reader.releaseLock()
    }
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