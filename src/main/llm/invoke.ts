import { createOpenAiCompatibleProvider } from '../providers/openai-compatible'
import type { ChatMessage } from '../providers/types'
import { resolveTargets, type ResolvedTarget } from './route'
import { recordLlmCall } from './usage'

export type LlmRole = 'architect' | 'writer' | 'reviewer' | 'extractor' | 'embedder'

export interface InvokeInput {
  role: LlmRole
  messages: ChatMessage[]
  signal?: AbortSignal
  onDelta?: (delta: string) => void
  temperature?: number
  maxTokens?: number
}

/** 中文为主的粗略 token 估算，仅在服务端未返回 usage 时兜底 */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const rest = text.length - cjk
  return Math.max(1, Math.round(cjk + rest / 4))
}

/** 简单的并发闸门，用于 max_concurrency */
class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.active += 1

    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      this.waiters.shift()?.()
    }
  }
}

const semaphores = new Map<string, Semaphore>()
/** providerId → 下一个允许发起请求的时间戳 */
const rateGates = new Map<number, number>()

function limiterFor(target: ResolvedTarget): Semaphore {
  const key = `${target.providerId}:${target.maxConcurrency}`
  let semaphore = semaphores.get(key)
  if (!semaphore) {
    semaphore = new Semaphore(target.maxConcurrency)
    semaphores.set(key, semaphore)
  }
  return semaphore
}

/** 严格限速：主要给自定义反代端点用，降低触发风控的概率 */
async function waitForRateLimit(providerId: number, perMinute: number): Promise<void> {
  if (perMinute <= 0) return
  const interval = Math.ceil(60_000 / perMinute)
  const now = Date.now()
  const nextAllowed = rateGates.get(providerId) ?? 0
  rateGates.set(providerId, Math.max(now, nextAllowed) + interval)

  const wait = nextAllowed - now
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

/**
 * 按角色路由调用模型：主端点失败时按 fallback 链依次重试；
 * 全程记入 `llm_call` 用量。
 */
export async function invokeChat(input: InvokeInput): Promise<string> {
  const targets = resolveTargets(input.role)
  if (targets.length === 0) {
    throw new Error('尚未配置可用的模型接入：请在「设置 · 官方 API」添加端点，或改用「Agent 模式」由外部 Agent 驱动')
  }

  const promptText = input.messages.map((message) => message.content).join('\n')
  let lastError = new Error('没有可用的模型端点')

  for (const target of targets) {
    const release = await limiterFor(target).acquire()
    const startedAt = Date.now()
    let promptTokens = 0
    let completionTokens = 0
    let emitted = ''

    try {
      await waitForRateLimit(target.providerId, target.rateLimitPerMin)

      const provider = createOpenAiCompatibleProvider({
        id: String(target.providerId),
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        model: target.model,
        headers: target.headers
      })

      let text = ''
      for await (const chunk of provider.chat(
        {
          model: target.model,
          messages: input.messages,
          temperature: input.temperature,
          maxTokens: input.maxTokens
        },
        input.signal
      )) {
        if (chunk.delta) {
          text += chunk.delta
          emitted += chunk.delta
          input.onDelta?.(chunk.delta)
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.promptTokens
          completionTokens = chunk.usage.completionTokens
        }
      }

      recordLlmCall({
        providerId: target.providerId,
        providerName: target.providerName,
        model: target.model,
        role: input.role,
        promptTokens: promptTokens || estimateTokens(promptText),
        completionTokens: completionTokens || estimateTokens(text),
        durationMs: Date.now() - startedAt,
        success: true,
        error: '',
        createdAt: Date.now()
      })
      return text
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      recordLlmCall({
        providerId: target.providerId,
        providerName: target.providerName,
        model: target.model,
        role: input.role,
        promptTokens: promptTokens || estimateTokens(promptText),
        completionTokens: completionTokens || estimateTokens(emitted),
        durationMs: Date.now() - startedAt,
        success: false,
        error: lastError.message,
        createdAt: Date.now()
      })

      // 已中断、或已经吐出内容（再换端点会产生重复文本）时不再重试
      if (input.signal?.aborted || emitted.length > 0) throw lastError
    } finally {
      release()
    }
  }

  throw lastError
}

/** 从模型输出里尽力提取 JSON：容忍 ```json 围栏与前后解释文字 */
export function tryParseJson(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()

  const candidates = [text]
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0)
  if (starts.length > 0) {
    const start = Math.min(...starts)
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
    if (end > start) candidates.push(text.slice(start, end + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // 尝试下一个候选
    }
  }
  return undefined
}

/**
 * 调用模型并要求结构化 JSON 输出。
 * 首次解析失败时追加一句强约束重试一次，仍失败则抛出可读错误。
 */
export async function invokeJson<T>(input: InvokeInput, parse: (raw: unknown) => T): Promise<T> {
  const first = tryParseJson(await invokeChat(input))
  if (first !== undefined) {
    try {
      return parse(first)
    } catch {
      // 结构不符，进入重试
    }
  }

  const retry = tryParseJson(
    await invokeChat({
      ...input,
      messages: [
        ...input.messages,
        { role: 'user', content: '请只输出合法 JSON，不要任何解释文字，不要使用 Markdown 代码块。' }
      ]
    })
  )

  if (retry === undefined) throw new Error('模型未返回可解析的 JSON，请重试或更换模型')
  try {
    return parse(retry)
  } catch (error) {
    throw new Error(`模型返回的 JSON 结构不符合要求：${error instanceof Error ? error.message : String(error)}`)
  }
}