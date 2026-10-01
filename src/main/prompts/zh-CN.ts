import type { GenerationMode } from '@shared/types'
import type { ChatMessage } from '../providers/types'
import { resolvePrompt } from './registry'

/** 单章生成所需的全部上下文（由 generate.ts 从数据库装配） */
export interface ChapterPromptContext {
  bookTitle: string
  genre: string
  premise: string
  worldbuilding: string
  protagonist: string
  goldenFinger: string
  style: string
  globalGuidance: string
  coreOutline: string
  chapterNo: number
  chapterTitle: string
  purpose: string
  keyEvents: string
  characters: string[]
  sceneBeats: string[]
  suspenseHook: string
  userGuidance: string
  /** 上一章结尾节选 */
  previousExcerpt: string
  /** 本章已有正文（续写/重写/润色使用） */
  existingContent: string
  /** 真相文件 2：角色矩阵当前状态（长篇一致性依据） */
  characterStates: string
  /** 真相文件 3：活跃伏笔 / 支线池 */
  activeHooks: string
  /** 真相文件 4：滚动的前情摘要链 */
  recentSummaries: string
  /** A2：文风仿写画像（人类可读段落；空串表示未启用） */
  styleProfile: string
  /** A3：向量检索召回的「相关回忆」（空串表示未启用 / 无命中） */
  recalledMemories: string
  targetWords: number
}

const NO_MARKDOWN =
  '只输出章节正文本身：不要写章节标题、不要写任何解释或说明、不要使用 Markdown 标记（如 #、**、-）。'

function row(label: string, value: string): string {
  const trimmed = value.trim()
  return trimmed ? `${label}：${trimmed}` : ''
}

function projectSection(c: ChapterPromptContext): string {
  const rows = [
    row('书名', c.bookTitle),
    row('题材', c.genre),
    row('一句话灵感', c.premise),
    row('世界观', c.worldbuilding),
    row('主角', c.protagonist),
    row('金手指', c.goldenFinger),
    row('文风', c.style),
    row('全局指引', c.globalGuidance)
  ].filter(Boolean)
  return rows.length ? `【作品设定】\n${rows.join('\n')}` : ''
}

function outlineSection(c: ChapterPromptContext): string {
  const outline = c.coreOutline.trim()
  return outline ? `【总大纲】\n${outline}` : ''
}

function briefSection(c: ChapterPromptContext): string {
  const rows = [
    row('本章目的', c.purpose),
    row('关键事件', c.keyEvents),
    row('出场角色', c.characters.join('、')),
    row('悬念钩子', c.suspenseHook),
    row('额外要求', c.userGuidance)
  ].filter(Boolean)

  const beats = c.sceneBeats
    .map((beat) => beat.trim())
    .filter(Boolean)
    .map((beat, index) => `${index + 1}. ${beat}`)
  if (beats.length) rows.push(`场景节拍：\n${beats.join('\n')}`)

  const title = c.chapterTitle.trim() || '（未命名）'
  return `【本章细纲 · 第${c.chapterNo}章 ${title}】\n${rows.join('\n')}`
}

function previousSection(c: ChapterPromptContext): string {
  const excerpt = c.previousExcerpt.trim()
  return excerpt ? `【前情提要（上一章结尾）】\n${excerpt}` : ''
}

/** A2：文风画像段落（仿写画像一旦生成，就是「必须遵守」的硬约束） */
function styleSection(c: ChapterPromptContext): string {
  const profile = c.styleProfile.trim()
  return profile ? `【文风画像（必须遵守）】\n${profile}` : ''
}

/** A3：向量检索召回的过往片段（按相似度排序的相关回忆） */
function recallSection(c: ChapterPromptContext): string {
  const recalled = c.recalledMemories.trim()
  return recalled ? `【相关回忆（按相似度从既有章节检索，供保持细节一致）】\n${recalled}` : ''
}

/** 真相文件段落：角色当前状态 / 活跃伏笔 / 前情摘要链（长篇一致性的依据） */
function memorySection(c: ChapterPromptContext): string {
  const rows: string[] = []
  if (c.recentSummaries.trim()) rows.push(`【前情摘要链】\n${c.recentSummaries.trim()}`)
  if (c.characterStates.trim()) rows.push(`【角色当前状态（必须遵守）】\n${c.characterStates.trim()}`)
  if (c.activeHooks.trim()) rows.push(`【活跃伏笔 / 支线（本章可推进，不要写反）】\n${c.activeHooks.trim()}`)
  return rows.join('\n\n')
}

function baseSections(c: ChapterPromptContext): string[] {
  return [
    styleSection(c),
    projectSection(c),
    outlineSection(c),
    briefSection(c),
    memorySection(c),
    recallSection(c),
    previousSection(c)
  ].filter(Boolean)
}

function wrap(system: string, sections: string[]): ChatMessage[] {
  return [
    { role: 'system', content: system },
    { role: 'user', content: sections.filter(Boolean).join('\n\n') }
  ]
}

export function buildMessagesFor(mode: GenerationMode, context: ChapterPromptContext): ChatMessage[] {
  switch (mode) {
    case 'draft':
      return buildDraft(context)
    case 'continue':
      return buildContinue(context)
    case 'rewrite':
      return buildRewrite(context)
    case 'polish':
      return buildPolish(context)
  }
}

function buildDraft(c: ChapterPromptContext): ChatMessage[] {
  const tpl = resolvePrompt('chapter.draft', {
    chapterNo: c.chapterNo,
    targetWords: c.targetWords,
    noMarkdown: NO_MARKDOWN
  })
  return wrap(tpl.system, [...baseSections(c), tpl.instruction])
}

function buildContinue(c: ChapterPromptContext): ChatMessage[] {
  const tpl = resolvePrompt('chapter.continue', {
    chapterNo: c.chapterNo,
    targetWords: c.targetWords,
    noMarkdown: NO_MARKDOWN
  })
  return wrap(tpl.system, [
    ...baseSections(c),
    `【已写正文（需无缝衔接，不要重复输出）】\n${c.existingContent.trim()}`,
    tpl.instruction
  ])
}

function buildRewrite(c: ChapterPromptContext): ChatMessage[] {
  const tpl = resolvePrompt('chapter.rewrite', {
    chapterNo: c.chapterNo,
    targetWords: c.targetWords,
    noMarkdown: NO_MARKDOWN
  })
  const existing = c.existingContent.trim()
  return wrap(tpl.system, [
    ...baseSections(c),
    existing ? `【当前正文（可参考，允许完全重写）】\n${existing}` : '',
    tpl.instruction
  ])
}

function buildPolish(c: ChapterPromptContext): ChatMessage[] {
  const tpl = resolvePrompt('chapter.polish', { chapterNo: c.chapterNo, noMarkdown: NO_MARKDOWN })
  return wrap(tpl.system, [
    styleSection(c),
    projectSection(c),
    outlineSection(c),
    `【待润色正文 · 第${c.chapterNo}章】\n${c.existingContent.trim()}`,
    tpl.instruction
  ])
}

/* ------------------------------ 向导 / 细纲辅助 ------------------------------ */

export interface OutlinePromptInput {
  bookTitle: string
  genre: string
  totalChapters: number
  wordsPerChapter: number
  premise: string
}

/** 一句话灵感 → 设定 + 总大纲（模板键 outline.generate） */
export function buildOutlineMessages(input: OutlinePromptInput): ChatMessage[] {
  const tpl = resolvePrompt('outline.generate', {
    bookTitle: input.bookTitle,
    genre: input.genre,
    totalChapters: input.totalChapters,
    wordsPerChapter: input.wordsPerChapter,
    premise: input.premise
  })
  return [
    { role: 'system', content: tpl.system },
    { role: 'user', content: tpl.instruction }
  ]
}

export interface BriefBatchPromptInput {
  bookTitle: string
  genre: string
  premise: string
  worldbuilding: string
  protagonist: string
  goldenFinger: string
  style: string
  coreOutline: string
  fromChapter: number
  toChapter: number
  /** 之前已确定的章节标题，用于衔接 */
  previousTitles: Array<{ chapterNo: number; title: string }>
}

/** 总大纲 → 指定区间逐章细纲（模板键 brief.batch + 数据段） */
export function buildBriefBatchMessages(input: BriefBatchPromptInput): ChatMessage[] {
  const count = input.toChapter - input.fromChapter + 1
  const previous = input.previousTitles.length
    ? `【已有章节标题（需衔接，不要重复）】\n${input.previousTitles
        .map((item) => `第${item.chapterNo}章 ${item.title}`)
        .join('\n')}`
    : ''

  const tpl = resolvePrompt('brief.batch', {
    fromChapter: input.fromChapter,
    toChapter: input.toChapter,
    count,
    bookTitle: input.bookTitle,
    genre: input.genre
  })

  return [
    { role: 'system', content: tpl.system },
    {
      role: 'user',
      content: [
        `【任务】基于总大纲，为第 ${input.fromChapter} 章到第 ${input.toChapter} 章逐章编写细纲。`,
        [
          row('书名', input.bookTitle),
          row('题材', input.genre),
          row('故事前提', input.premise),
          row('世界观', input.worldbuilding),
          row('主角', input.protagonist),
          row('金手指', input.goldenFinger),
          row('文风', input.style)
        ]
          .filter(Boolean)
          .join('\n'),
        input.coreOutline.trim() ? `【总大纲】\n${input.coreOutline.trim()}` : '',
        previous,
        tpl.instruction
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
}

export interface BriefExpandPromptInput {
  bookTitle: string
  genre: string
  coreOutline: string
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

/** 单章细纲补全 / 强化（模板键 brief.expand + 数据段） */
export function buildBriefExpandMessages(input: BriefExpandPromptInput): ChatMessage[] {
  const current = [
    row('标题', input.current.title),
    row('本章目的', input.current.purpose),
    row('关键事件', input.current.keyEvents),
    row('出场角色', input.current.characters.join('、')),
    row('悬念钩子', input.current.suspenseHook),
    input.current.sceneBeats.length
      ? `场景节拍：\n${input.current.sceneBeats.map((beat, index) => `${index + 1}. ${beat}`).join('\n')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')

  const tpl = resolvePrompt('brief.expand', { chapterNo: input.chapterNo })

  return [
    { role: 'system', content: tpl.system },
    {
      role: 'user',
      content: [
        `【任务】补全并强化第 ${input.chapterNo} 章的细纲。`,
        [row('书名', input.bookTitle), row('题材', input.genre)].filter(Boolean).join('\n'),
        input.coreOutline.trim() ? `【总大纲】\n${input.coreOutline.trim()}` : '',
        `【当前细纲（可能不完整）】\n${current || '（尚未填写）'}`,
        tpl.instruction
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
}

/* ============================ M3：审计与记忆回写 ============================ */

export interface AuditPromptInput {
  bookTitle: string
  genre: string
  worldbuilding: string
  protagonist: string
  chapterNo: number
  chapterTitle: string
  keyEvents: string
  characters: string[]
  /** 角色矩阵当前状态摘要（真相文件 2） */
  characterStates: string
  /** 待处理伏笔池摘要（真相文件 3） */
  pendingHooks: string
  /** 前一章摘要 */
  previousSummary: string
  content: string
}

/** 一致性审计（模板键 audit.consistency + 数据段） */
export function buildAuditMessages(input: AuditPromptInput): ChatMessage[] {
  const tpl = resolvePrompt('audit.consistency', {
    bookTitle: input.bookTitle,
    genre: input.genre,
    chapterNo: input.chapterNo
  })
  return [
    { role: 'system', content: tpl.system },
    {
      role: 'user',
      content: [
        `【任务】对照"真相文件"，对第 ${input.chapterNo} 章正文做一致性审计，只报告**明确可证实的矛盾**。`,
        [row('书名', input.bookTitle), row('题材', input.genre), row('世界观', input.worldbuilding), row('主角', input.protagonist)]
          .filter(Boolean)
          .join('\n'),
        row('本章标题', input.chapterTitle),
        row('本章关键事件', input.keyEvents),
        row('本章出场角色', input.characters.join('、')),
        input.characterStates.trim() ? `【角色矩阵（当前状态）】\n${input.characterStates.trim()}` : '',
        input.pendingHooks.trim() ? `【待处理伏笔池】\n${input.pendingHooks.trim()}` : '',
        input.previousSummary.trim() ? `【前一章摘要】\n${input.previousSummary.trim()}` : '',
        `【本章正文】\n${input.content.trim()}`,
        tpl.instruction
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
}

export interface MemoryPromptInput {
  bookTitle: string
  genre: string
  chapterNo: number
  chapterTitle: string
  characters: string[]
  /** 上一章摘要，用于衔接 */
  previousSummary: string
  /** 角色矩阵当前状态摘要，用于增量更新 */
  characterStates: string
  /** 待处理伏笔池摘要 */
  pendingHooks: string
  content: string
}

/** 章节摘要 + 状态抽取（模板键 memory.summarize + 数据段） */
export function buildMemoryMessages(input: MemoryPromptInput): ChatMessage[] {
  const tpl = resolvePrompt('memory.summarize', { chapterNo: input.chapterNo })
  return [
    { role: 'system', content: tpl.system },
    {
      role: 'user',
      content: [
        `【任务】为第 ${input.chapterNo} 章正文建立记忆快照。`,
        [row('书名', input.bookTitle), row('题材', input.genre), row('本章标题', input.chapterTitle)]
          .filter(Boolean)
          .join('\n'),
        row('本章出场角色', input.characters.join('、')),
        input.previousSummary.trim() ? `【上一章摘要】\n${input.previousSummary.trim()}` : '',
        input.characterStates.trim() ? `【既有角色状态（用于增量更新）】\n${input.characterStates.trim()}` : '',
        input.pendingHooks.trim() ? `【既有待处理伏笔】\n${input.pendingHooks.trim()}` : '',
        `【本章正文】\n${input.content.trim()}`,
        tpl.instruction
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
}

/* ============================ M7：导入解析兜底 ============================ */

export interface ImportExtractPromptInput {
  bookTitle?: string
  chapterNo: number
  title: string
  /** 未被标签命中的原始文本块 */
  rawText: string
}

/** 导入解析兜底（模板键 import.extract_brief，默认关闭） */
export function buildImportExtractMessages(input: ImportExtractPromptInput): ChatMessage[] {
  const tpl = resolvePrompt('import.extract_brief', { chapterNo: input.chapterNo })
  return [
    { role: 'system', content: tpl.system },
    {
      role: 'user',
      content: [
        '【任务】把下面这段未标注的章节大纲整理成结构化字段。',
        [row('书名', input.bookTitle ?? ''), row('章节号', String(input.chapterNo)), row('章节标题', input.title)]
          .filter(Boolean)
          .join('\n'),
        `【待整理文本】\n${input.rawText.trim()}`,
        tpl.instruction
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
}

export interface FixPromptInput {
  bookTitle: string
  genre: string
  chapterNo: number
  chapterTitle: string
  content: string
  /** 待修复的问题（来自审计报告） */
  issues: Array<{ dimension: string; detail: string; evidence?: string; paragraph?: number }>
}

/** 定点修复（模板键 fix.spot + 数据段）：只改问题句段，不整章重写 */
export function buildFixMessages(input: FixPromptInput): ChatMessage[] {
  const issueLines = input.issues
    .map((issue, index) => {
      const where = issue.paragraph !== undefined ? `（第 ${issue.paragraph + 1} 段）` : ''
      const quote = issue.evidence ? `｜原句：${issue.evidence}` : ''
      return `${index + 1}. 【${issue.dimension}】${where}${issue.detail}${quote}`
    })
    .join('\n')

  const tpl = resolvePrompt('fix.spot', { chapterNo: input.chapterNo, noMarkdown: NO_MARKDOWN })

  return [
    { role: 'system', content: tpl.system },
    {
      role: 'user',
      content: [
        `【任务】对第 ${input.chapterNo} 章正文做「定点修复」：只修掉下面列出的问题，其余一字不动。`,
        [row('书名', input.bookTitle), row('题材', input.genre), row('本章标题', input.chapterTitle)]
          .filter(Boolean)
          .join('\n'),
        `【待修复问题】\n${issueLines || '（无）'}`,
        `【本章正文】\n${input.content.trim()}`,
        tpl.instruction
      ].join('\n\n')
    }
  ]
}

/* ============================ A2：文风仿写画像 ============================ */

export interface StyleProfilePromptInput {
  bookTitle: string
  genre: string
  sample: string
}

/** 参考文本 → 结构化文风画像（模板键 style.profile） */
export function buildStyleProfileMessages(input: StyleProfilePromptInput): ChatMessage[] {
  const tpl = resolvePrompt('style.profile', {
    bookTitle: input.bookTitle,
    genre: input.genre,
    sampleChars: input.sample.length
  })
  return [
    { role: 'system', content: tpl.system },
    {
      role: 'user',
      content: [tpl.instruction, `【参考文本】\n${input.sample.trim()}`].join('\n\n')
    }
  ]
}
