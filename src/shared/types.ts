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
  }
  draft: {
    list(projectId: number): Promise<ChapterDraft[]>
    save(input: DraftSaveInput): Promise<ChapterDraft>
    remove(id: number): Promise<void>
  }
  app: {
    /** 数据库文件绝对路径，用于排查与备份 */
    dbPath(): Promise<string>
  }
}