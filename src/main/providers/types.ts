import type { ProviderTestResult } from '@shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface ChatChunk {
  /** 增量文本 */
  delta: string
  /** 部分服务端会在流末尾返回用量（需要 stream_options.include_usage） */
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

/**
 * 统一的模型调用抽象（计划书 §6.1）。
 * M1 仅落地 openai-compatible 一种实现；M2 扩展 native / agent-bridge / reverse-proxy。
 */
export interface EmbedRequest {
  model: string
  input: string[]
}

export interface EmbedResponse {
  vectors: number[][]
  promptTokens?: number
}

export interface ChatProvider {
  readonly id: string
  chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>
  health(signal?: AbortSignal): Promise<ProviderTestResult>
  /** A3：向量检索用的 embedding（端点不支持时可不实现） */
  embed?(request: EmbedRequest, signal?: AbortSignal): Promise<EmbedResponse>
}