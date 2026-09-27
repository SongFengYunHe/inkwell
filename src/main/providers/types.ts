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
}

/**
 * 统一的模型调用抽象（计划书 §6.1）。
 * M1 仅落地 openai-compatible 一种实现；M2 扩展 native / agent-bridge / reverse-proxy。
 */
export interface ChatProvider {
  readonly id: string
  chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>
  health(signal?: AbortSignal): Promise<ProviderTestResult>
}