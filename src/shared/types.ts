/**
 * 主进程 / 预加载 / 渲染进程共享的实体类型（DTO）。
 * 仅描述跨进程传输的数据形态，不依赖任何 Node 或 DOM 专有 API。
 */

/** 项目（对应计划书 §5.1 `project` 表，M0 采用精简字段集） */
export interface Project {
  id: number
  name: string
  genre: string
  targetAudience: string
  /** 预计章数 */
  totalChapters: number
  /** 单章目标字数 */
  wordsPerChapter: number
  language: string
  /** 文风 */
  style: string
  /** 一句话灵感 / 故事前提 */
  premise: string
  /** 世界观设定 */
  worldbuilding: string
  /** 主角档案 */
  protagonist: string
  /** 金手指 */
  goldenFinger: string
  /** 全局写作指引 */
  globalGuidance: string
  /** L1 总大纲 */
  coreOutline: string
  createdAt: number
  updatedAt: number
}

/** 每章细纲（对应计划书 §5.1 `chapter_brief` 表） */
export interface ChapterBrief {
  id: number
  projectId: number
  chapterNo: number
  volumeIdx: number
  title: string
  /** 章节角色定位（如 开篇/推进/高潮/过渡） */
  role: string
  /** 本章目的 */
  purpose: string
  /** 关键事件 */
  keyEvents: string
  /** 出场角色 */
  characters: string[]
  /** 场景节拍 */
  sceneBeats: string[]
  /** 悬念钩子 */
  suspenseHook: string
  /** 用户额外要求 */
  userGuidance: string
  notes: string
  createdAt: number
  updatedAt: number
}

/** 正文草稿（对应计划书 §5.1 `chapter_draft` 表，M0 仅落地最小字段） */
export interface ChapterDraft {
  id: number
  projectId: number
  chapterNo: number
  version: number
  /** draft | revised | finalized | archived */
  status: string
  /** write | rewrite */
  source: string
  content: string
  wordCount: number
  createdAt: number
  updatedAt: number
}

/** 新建项目入参 */
export interface ProjectCreateInput {
  name: string
  genre?: string
  totalChapters?: number
  wordsPerChapter?: number
  premise?: string
}

/** 更新项目入参（仅传入需要变更的字段） */
export type ProjectUpdateInput = Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>> & {
  id: number
}

/** 保存细纲入参（id 缺省表示新建） */
export type BriefSaveInput = Partial<Omit<ChapterBrief, 'id' | 'createdAt' | 'updatedAt'>> & {
  id?: number
  projectId: number
  chapterNo: number
}

/** 保存草稿入参（id 缺省表示新建） */
export type DraftSaveInput = Partial<Omit<ChapterDraft, 'id' | 'createdAt' | 'updatedAt'>> & {
  id?: number
  projectId: number
  chapterNo: number
}

/** 接入类型：官方/中转（OpenAI 兼容）与自定义反代端点 */
export type ProviderKind = 'openai-compatible' | 'custom-reverse-proxy'

/** 创作角色（计划书 §6.1） */
export type LlmRoleName = 'architect' | 'writer' | 'reviewer' | 'extractor' | 'embedder'

/** 模型接入配置（对应计划书 §5.1 `provider` 表） */
export interface Provider {
  id: number
  kind: ProviderKind
  name: string
  baseUrl: string
  model: string
  enabled: boolean
  /** 是否已保存密钥（密钥本身永不出主进程） */
  hasApiKey: boolean
  /** 自定义请求头（反代端点常用） */
  headers: Record<string, string>
  /** 每分钟最大请求数，0 表示不限速 */
  rateLimitPerMin: number
  /** 反代端点的风险确认 */
  riskAccepted: boolean
  createdAt: number
  updatedAt: number
}

/** 保存接入配置入参；`apiKey` 留空表示保持原密钥不变 */
export interface ProviderSaveInput {
  id?: number
  kind?: ProviderKind
  name: string
  baseUrl: string
  model: string
  apiKey?: string
  enabled?: boolean
  headers?: Record<string, string>
  rateLimitPerMin?: number
  riskAccepted?: boolean
}

/** 角色 → 模型路由 */
export interface RoleRoute {
  id: number
  role: LlmRoleName
  providerId: number
  /** 留空表示沿用 provider 的默认模型 */
  model: string
  fallbackChain: number[]
  maxConcurrency: number
  updatedAt: number
}

export interface RoleRouteSaveInput {
  role: LlmRoleName
  providerId: number
  model?: string
  fallbackChain?: number[]
  maxConcurrency?: number
}

/** 单次调用的用量记录 */
export interface LlmCallRecord {
  id: number
  providerId: number | null
  providerName: string
  model: string
  role: string
  promptTokens: number
  completionTokens: number
  durationMs: number
  success: boolean
  error: string
  createdAt: number
}

/** 用量仪表盘数据 */
export interface UsageSummary {
  totalCalls: number
  failedCalls: number
  promptTokens: number
  completionTokens: number
  totalDurationMs: number
  byRole: Array<{ role: string; calls: number; tokens: number }>
  recent: LlmCallRecord[]
}

/** 连接测试结果 */
export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs: number
}

/** 单章生成模式 */
export type GenerationMode = 'draft' | 'continue' | 'rewrite' | 'polish'

export interface GenerateStartInput {
  requestId: string
  projectId: number
  chapterNo: number
  mode: GenerationMode
}

/** 生成过程中的流式事件（主进程 → 渲染进程推送） */
export type GenerateEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done'; draft: ChapterDraft }
  | { requestId: string; type: 'error'; message: string }

/** 新建向导进度（一句话灵感 → 设定/大纲 → 逐章细纲） */
export interface WizardProgress {
  phase: 'outline' | 'briefs' | 'done'
  message: string
  completed: number
  total: number
}

export interface WizardStartInput {
  requestId: string
  projectId: number
}

export type WizardEvent =
  | { requestId: string; type: 'progress'; progress: WizardProgress }
  | { requestId: string; type: 'done'; briefsCreated: number }
  | { requestId: string; type: 'error'; message: string }

/** 细纲 AI 补全的输入 */
export interface BriefExpandInput {
  projectId: number
  chapterNo: number
  current: {
    title: string
    purpose: string
    keyEvents: string
    characters: string[]
    sceneBeats: string[]
    suspenseHook: string
  }
}

/** 细纲 AI 补全的建议结果（需用户确认后才落库） */
export interface BriefSuggestion {
  chapterNo: number
  title: string
  purpose: string
  keyEvents: string
  characters: string[]
  sceneBeats: string[]
  suspenseHook: string
}

/** 预加载脚本向渲染进程暴露的 API 契约 */
export interface InkwellApi {
  project: {
    list(): Promise<Project[]>
    get(id: number): Promise<Project | null>
    create(input: ProjectCreateInput): Promise<Project>
    update(input: ProjectUpdateInput): Promise<Project>
    remove(id: number): Promise<void>
  }
  brief: {
    list(projectId: number): Promise<ChapterBrief[]>
    save(input: BriefSaveInput): Promise<ChapterBrief>
    remove(id: number): Promise<void>
    /** AI 补全单章细纲，仅返回建议，不落库 */
    expand(input: BriefExpandInput): Promise<BriefSuggestion>
  }
  draft: {
    list(projectId: number): Promise<ChapterDraft[]>
    save(input: DraftSaveInput): Promise<ChapterDraft>
    remove(id: number): Promise<void>
  }
  provider: {
    list(): Promise<Provider[]>
    save(input: ProviderSaveInput): Promise<Provider>
    remove(id: number): Promise<void>
    /** 用当前表单值直接测试连通性（不落库） */
    test(input: ProviderSaveInput): Promise<ProviderTestResult>
  }
  route: {
    list(): Promise<RoleRoute[]>
    save(input: RoleRouteSaveInput): Promise<RoleRoute>
    remove(role: LlmRoleName): Promise<void>
  }
  usage: {
    summary(): Promise<UsageSummary>
  }
  generate: {
    start(input: GenerateStartInput): Promise<void>
    abort(requestId: string): Promise<void>
    /** 订阅流式事件，返回取消订阅函数 */
    onEvent(listener: (event: GenerateEvent) => void): () => void
  }
  wizard: {
    start(input: WizardStartInput): Promise<void>
    abort(requestId: string): Promise<void>
    onEvent(listener: (event: WizardEvent) => void): () => void
  }
  app: {
    /** 数据库文件绝对路径，用于排查与备份 */
    dbPath(): Promise<string>
  }
}