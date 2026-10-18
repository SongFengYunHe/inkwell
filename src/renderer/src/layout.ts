import type { ChapterBrief, ChapterDraftSummary, Project } from '@shared/types'

/**
 * M13-B 工作区布局模型（单一事实来源）。
 *
 * 「动态布线」= 布局跟着人和写作阶段走：
 *   - 每个项目记住自己的布局（面板顺序 / 宽度 / 折叠态 / 活动 Tab）；
 *   - 跨项目有「默认布局」；
 *   - 阶段自适应只在「跟随阶段」模式下改变前置面板，不动用户的自定义布局。
 *
 * 内存模型与磁盘模型共用此结构，序列化后存 ui_pref（键 layout:<projectId> / layout:default）。
 */

export type WorkspaceTabKey = 'brief' | 'outline' | 'draft' | 'memory'
export type DockPanelId = 'memory' | 'audit'
export type PresetKey = 'focus' | 'compare' | 'research' | 'custom'

export interface WorkspaceLayout {
  preset: PresetKey
  /** 是否跟随写作阶段自动前置相关面板 */
  followStage: boolean
  /** 左侧章节导航 */
  navSide: 'left' | 'right'
  navCollapsed: boolean
  navWidth: number
  /** 右侧辅助 Dock（记忆 / 本章审计）与顺序 */
  right: DockPanelId[]
  rightCollapsed: boolean
  rightWidth: number
  /** 右侧当前显示的面板 */
  activeRight: DockPanelId | null
  /** 主区 Tab 顺序与当前 Tab */
  tabs: WorkspaceTabKey[]
  activeTab: WorkspaceTabKey
}

export const TAB_LABEL: Record<WorkspaceTabKey, string> = {
  brief: '细纲',
  outline: '设定与大纲',
  draft: '正文',
  memory: '记忆'
}

export const DOCK_LABEL: Record<DockPanelId, string> = {
  memory: '记忆',
  audit: '本章审计'
}

const NAV_WIDTH_MIN = 160
const NAV_WIDTH_MAX = 420
const RIGHT_WIDTH_MIN = 280
const RIGHT_WIDTH_MAX = 720

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  preset: 'custom',
  followStage: true,
  navSide: 'left',
  navCollapsed: false,
  navWidth: 240,
  right: [],
  rightCollapsed: true,
  rightWidth: 420,
  activeRight: null,
  tabs: ['brief', 'outline', 'draft', 'memory'],
  activeTab: 'brief'
}

/**
 * 三套内置工作区预设（一键切换，可另存为自定义）。
 * 注意：预设只覆盖「布局」字段，不改变文档内容。
 */
export const PRESETS: Record<
  Exclude<PresetKey, 'custom'>,
  { label: string; hint: string; apply: Partial<WorkspaceLayout> }
> = {
  focus: {
    label: '专注写作',
    hint: '导航收窄、右侧全收起，只留正文',
    apply: { activeTab: 'draft', right: [], rightCollapsed: true, activeRight: null, navWidth: 200, navCollapsed: false }
  },
  compare: {
    label: '对照修订',
    hint: '正文 + 右侧本章审计同屏对照',
    apply: {
      activeTab: 'draft',
      right: ['audit'],
      rightCollapsed: false,
      activeRight: 'audit',
      rightWidth: 460,
      navWidth: 240
    }
  },
  research: {
    label: '素材研究',
    hint: '设定与大纲 + 右侧记忆（真相文件）',
    apply: {
      activeTab: 'outline',
      tabs: ['outline', 'brief', 'draft'],
      right: ['memory'],
      rightCollapsed: false,
      activeRight: 'memory',
      rightWidth: 460,
      navWidth: 240
    }
  }
}

/** 不变量：记忆面板要么在主区 Tab，要么在右侧 Dock，不能同时出现两处 */
export function normalizeLayout(input: WorkspaceLayout): WorkspaceLayout {
  const layout: WorkspaceLayout = {
    ...input,
    navWidth: clamp(input.navWidth, NAV_WIDTH_MIN, NAV_WIDTH_MAX),
    rightWidth: clamp(input.rightWidth, RIGHT_WIDTH_MIN, RIGHT_WIDTH_MAX),
    tabs: dedupe(input.tabs.filter((key): key is WorkspaceTabKey => key in TAB_LABEL)),
    right: dedupe(input.right.filter((key): key is DockPanelId => key in DOCK_LABEL))
  }
  if (layout.right.includes('memory')) {
    layout.tabs = layout.tabs.filter((key) => key !== 'memory')
  } else if (!layout.tabs.includes('memory')) {
    layout.tabs = [...layout.tabs, 'memory']
  }
  const fallbackTab = layout.tabs[0] ?? 'brief'
  if (!layout.tabs.includes(layout.activeTab)) layout.activeTab = fallbackTab
  if (layout.right.length === 0) {
    layout.rightCollapsed = true
    layout.activeRight = null
  } else if (layout.activeRight === null || !layout.right.includes(layout.activeRight)) {
    layout.activeRight = layout.right[0] ?? null
  }
  return layout
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function dedupe<T>(list: T[]): T[] {
  return [...new Set(list)]
}

export function serializeLayout(layout: WorkspaceLayout): string {
  return JSON.stringify(layout)
}

/** 容错解析：磁盘上的旧值 / 手改值缺字段也能安全回落到默认 */
export function parseLayout(raw: string | undefined | null): WorkspaceLayout | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayout>
    return normalizeLayout({ ...DEFAULT_LAYOUT, ...parsed })
  } catch {
    return null
  }
}

export function applyPreset(base: WorkspaceLayout, preset: Exclude<PresetKey, 'custom'>): WorkspaceLayout {
  return normalizeLayout({ ...base, ...PRESETS[preset].apply, preset })
}

/* ---------------------------- 阶段自适应 ---------------------------- */

export type WorkspaceStage = 'ideate' | 'outline' | 'draft' | 'review' | 'export'

export interface StageInfo {
  stage: WorkspaceStage
  label: string
  hint: string
  /** 该阶段建议前置的 Tab 与 Dock */
  suggestTab: WorkspaceTabKey
  suggestRight?: DockPanelId[]
}

/**
 * 按「细纲覆盖率 + 已生成章节数」推断当前写作阶段。
 * 只用于前置面板与提示，不改变任何数据。
 */
export function inferStage(input: {
  project: Pick<Project, 'totalChapters'>
  briefs: ChapterBrief[]
  drafts: ChapterDraftSummary[]
}): StageInfo {
  const { project, briefs, drafts } = input
  const total = Math.max(1, project.totalChapters)
  const written = new Set(drafts.filter((item) => item.wordCount > 0).map((item) => item.chapterNo)).size
  const briefed = briefs.length
  const briefRatio = briefed / total
  const writeRatio = written / total

  if (briefed === 0) {
    return {
      stage: 'ideate',
      label: '构思',
      hint: '先出设定与大纲，再逐章补细纲',
      suggestTab: 'outline'
    }
  }
  if (briefRatio < 0.5) {
    return {
      stage: 'outline',
      label: '细纲',
      hint: `细纲 ${briefed}/${total} 章，补齐后即可连写`,
      suggestTab: 'brief'
    }
  }
  if (written === 0 || writeRatio < 0.9) {
    return {
      stage: 'draft',
      label: '正文',
      hint: `已写 ${written}/${total} 章`,
      suggestTab: 'draft'
    }
  }
  return {
    stage: 'review',
    label: '审校',
    hint: '正文已齐，建议逐章审校并一键修复',
    suggestTab: 'draft',
    suggestRight: ['audit']
  }
}
