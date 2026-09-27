import type { ChatMessage } from '../providers/types'
import { createOpenAiCompatibleProvider } from '../providers/openai-compatible'
import { getActiveProvider } from '../providers/store'

/** 创作角色（计划书 §6.1）；M1.5 仅使用 architect / writer，M2 由 RoleRouter 分派 */
export type LlmRole = 'architect' | 'writer' | 'reviewer' | 'extractor' | 'embedder'

export interface InvokeInput {
  role: LlmRole
  messages: ChatMessage[]
  signal?: AbortSignal
  onDelta?: (delta: string) => void
  temperature?: number
  maxTokens?: number
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

/** 调用模型并返回完整文本 */
export async function invokeChat(input: InvokeInput): Promise<string> {
  const active = getActiveProvider()
  if (!active) throw new Error('尚未配置模型接入，请先到「设置」添加一个 OpenAI 兼容端点')

  const provider = createOpenAiCompatibleProvider({
    id: String(active.dto.id),
    baseUrl: active.dto.baseUrl,
    apiKey: active.apiKey,
    model: active.dto.model
  })

  let text = ''
  for await (const chunk of provider.chat(
    {
      model: active.dto.model,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens
    },
    input.signal
  )) {
    text += chunk.delta
    input.onDelta?.(chunk.delta)
  }
  return text
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