import type { GenerationMode } from '@shared/types'
import type { ChatMessage } from '../providers/types'

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
  targetWords: number
}

const NO_MARKDOWN =
  '只输出章节正文本身：不要写章节标题、不要写任何解释或说明、不要使用 Markdown 标记（如 #、**、-）。'

const SYSTEM_WRITER = [
  '你是一位深耕中文网络文学多年的职业作家，擅长长篇连载。',
  '你的文字画面感强、节奏稳、对话自然，善于用具体细节推进剧情。',
  '你严格遵循给定的世界观、人物设定与大纲，绝不发明与之冲突的设定。'
].join('\n')

const SYSTEM_EDITOR =
  '你是一位资深中文小说编辑，擅长在不改动情节与信息量的前提下，提升文字的准确度、节奏与感染力。'

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

/** 真相文件段落：角色当前状态 / 活跃伏笔 / 前情摘要链（长篇一致性的依据） */
function memorySection(c: ChapterPromptContext): string {
  const rows: string[] = []
  if (c.recentSummaries.trim()) rows.push(`【前情摘要链】\n${c.recentSummaries.trim()}`)
  if (c.characterStates.trim()) rows.push(`【角色当前状态（必须遵守）】\n${c.characterStates.trim()}`)
  if (c.activeHooks.trim()) rows.push(`【活跃伏笔 / 支线（本章可推进，不要写反）】\n${c.activeHooks.trim()}`)
  return rows.join('\n\n')
}

function baseSections(c: ChapterPromptContext): string[] {
  return [projectSection(c), outlineSection(c), briefSection(c), memorySection(c), previousSection(c)].filter(Boolean)
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
  return wrap(SYSTEM_WRITER, [
    ...baseSections(c),
    [
      '【写作要求】',
      `- 写出第${c.chapterNo}章完整正文，约 ${c.targetWords} 字（允许 ±20% 浮动）`,
      '- 落到具体场景与人物动作，避免空洞概述与总结式叙述',
      '- 章末扣住「悬念钩子」，留下继续读下去的动力',
      `- ${NO_MARKDOWN}`
    ].join('\n')
  ])
}

function buildContinue(c: ChapterPromptContext): ChatMessage[] {
  return wrap(SYSTEM_WRITER, [
    ...baseSections(c),
    `【已写正文（需无缝衔接，不要重复输出）】\n${c.existingContent.trim()}`,
    [
      '【写作要求】',
      `- 承接上文继续写下去，新写约 ${c.targetWords} 字`,
      '- 人称、时态、语气、称谓必须与上文完全一致',
      '- 只输出新续写的正文，绝不要重复已有内容，也不要重复开头',
      `- ${NO_MARKDOWN}`
    ].join('\n')
  ])
}

function buildRewrite(c: ChapterPromptContext): ChatMessage[] {
  const existing = c.existingContent.trim()
  return wrap(SYSTEM_WRITER, [
    ...baseSections(c),
    existing ? `【当前正文（可参考，允许完全重写）】\n${existing}` : '',
    [
      '【写作要求】',
      `- 按上面的细纲重新撰写第${c.chapterNo}章完整正文，约 ${c.targetWords} 字`,
      '- 情节走向与设定必须与当前版本一致，但叙事视角、场景调度与细节描写要明显提升',
      `- ${NO_MARKDOWN}`
    ].join('\n')
  ])
}

function buildPolish(c: ChapterPromptContext): ChatMessage[] {
  return wrap(SYSTEM_EDITOR, [
    projectSection(c),
    outlineSection(c),
    `【待润色正文 · 第${c.chapterNo}章】\n${c.existingContent.trim()}`,
    [
      '【润色要求】',
      '- 情节、人物、对话内容与信息量保持不变，只改善文字表达',
      '- 消除 AI 腔：减少空洞排比、套话与重复用词，让句子更有呼吸感',
      '- 输出润色后的完整正文，不要输出任何修改说明',
      `- ${NO_MARKDOWN}`
    ].join('\n')
  ])
}

/* ------------------------------ 向导 / 细纲辅助 ------------------------------ */

const SYSTEM_PLANNER = [
  '你是一位资深中文网络小说策划，擅长把一句话灵感扩展成可连载的长篇设定与总大纲，',
  '并把总大纲拆成节奏合理、环环相扣的逐章细纲。',
  '你只输出 JSON，绝不输出任何解释性文字。'
].join('\n')

const JSON_ONLY = '只输出 JSON 本身：不要 Markdown 代码块，不要前后缀解释，不要注释。'

export interface OutlinePromptInput {
  bookTitle: string
  genre: string
  totalChapters: number
  wordsPerChapter: number
  premise: string
}

/** 一句话灵感 → 设定 + 总大纲 */
export function buildOutlineMessages(input: OutlinePromptInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PLANNER },
    {
      role: 'user',
      content: [
        '【任务】把下面的一句话灵感扩展为一部长篇小说的设定与总大纲。',
        [
          row('书名', input.bookTitle),
          row('题材', input.genre),
          row('预计章数', String(input.totalChapters)),
          row('单章目标字数', String(input.wordsPerChapter)),
          row('一句话灵感', input.premise)
        ]
          .filter(Boolean)
          .join('\n'),
        [
          '【输出格式】输出一个 JSON 对象，字段如下：',
          '{',
          '  "premise": "故事前提，200 字以内，交代主角处境与核心冲突",',
          '  "worldbuilding": "世界观设定，300 字以内",',
          '  "protagonist": "主角档案，200 字以内（身份、性格、目标、弱点）",',
          '  "goldenFinger": "金手指或核心设定，150 字以内",',
          '  "style": "推荐文风，一句话",',
          '  "coreOutline": "总大纲，按卷划分，给出主线推进与关键转折，600-1200 字"',
          '}',
          JSON_ONLY
        ].join('\n')
      ].join('\n\n')
    }
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

/** 总大纲 → 指定区间逐章细纲 */
export function buildBriefBatchMessages(input: BriefBatchPromptInput): ChatMessage[] {
  const count = input.toChapter - input.fromChapter + 1
  const previous = input.previousTitles.length
    ? `【已有章节标题（需衔接，不要重复）】\n${input.previousTitles
        .map((item) => `第${item.chapterNo}章 ${item.title}`)
        .join('\n')}`
    : ''

  return [
    { role: 'system', content: SYSTEM_PLANNER },
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
        [
          '【输出格式】输出一个 JSON 数组，共 ' + count + ' 项，chapterNo 依次为 ' +
            `${input.fromChapter} 到 ${input.toChapter}：`,
          '[',
          '  {',
          '    "chapterNo": ' + input.fromChapter + ',',
          '    "title": "章节标题，12 字以内",',
          '    "purpose": "本章目的，60 字以内",',
          '    "keyEvents": "关键事件，120 字以内",',
          '    "characters": ["出场角色", "..."],',
          '    "sceneBeats": ["场景节拍", "..."],',
          '    "suspenseHook": "章末悬念钩子，40 字以内"',
          '  }',
          ']',
          '- characters 给 2-5 个；sceneBeats 给 3-6 个，每个 30 字以内',
          '- 章节之间要有明确的推进关系，避免重复与原地打转',
          JSON_ONLY
        ].join('\n')
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

/** 单章细纲补全 / 强化 */
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

  return [
    { role: 'system', content: SYSTEM_PLANNER },
    {
      role: 'user',
      content: [
        `【任务】补全并强化第 ${input.chapterNo} 章的细纲。`,
        [row('书名', input.bookTitle), row('题材', input.genre)].filter(Boolean).join('\n'),
        input.coreOutline.trim() ? `【总大纲】\n${input.coreOutline.trim()}` : '',
        `【当前细纲（可能不完整）】\n${current || '（尚未填写）'}`,
        [
          '【输出格式】输出一个 JSON 对象：',
          '{',
          `  "chapterNo": ${input.chapterNo},`,
          '  "title": "章节标题，12 字以内",',
          '  "purpose": "本章目的，60 字以内",',
          '  "keyEvents": "关键事件，120 字以内",',
          '  "characters": ["出场角色"],',
          '  "sceneBeats": ["场景节拍"],',
          '  "suspenseHook": "章末悬念钩子"',
          '}',
          '- 保留当前细纲中合理的内容，补齐缺失项，并让情节更具体可写',
          '- characters 给 2-5 个；sceneBeats 给 3-6 个，每个 30 字以内',
          JSON_ONLY
        ].join('\n')
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
}

/* ============================ M3：审计与记忆回写 ============================ */

const SYSTEM_REVIEWER = [
  '你是一位极其严格的中文小说连续性审稿人，熟悉长篇连载的设定管理。',
  '你只依据给定的资料判断，不臆测未给出的信息；对没有把握的问题宁可放过。',
  '你只输出 JSON，绝不输出任何解释性文字。'
].join('\n')

const SYSTEM_EXTRACTOR = [
  '你是一位负责维护长篇小说"真相文件"的记忆管理员。',
  '你从本章正文中抽取可长期复用的事实：章节摘要、角色当前状态、世界状态增量、伏笔进展。',
  '你只记录正文中明确写出的事实，不推测、不补充。',
  '你只输出 JSON，绝不输出任何解释性文字。'
].join('\n')

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

/** 一致性审计（结构化 JSON，计划书 §12 `audit.consistency`） */
export function buildAuditMessages(input: AuditPromptInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_REVIEWER },
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
        [
          '【审计维度】仅检查以下语义维度：',
          '- OOC 出戏：角色言行与其性格 / 动机明显冲突',
          '- 设定冲突：与世界观、角色能力或既有事实矛盾',
          '- 时间线矛盾：时间推进前后不一致',
          '- 伏笔断线：应回收的伏笔被无视或写反',
          '- 称谓不一致：同一角色 / 事物被写成不同名字',
          '【输出格式】输出一个 JSON 对象：',
          '{',
          '  "issues": [',
          '    { "dimension": "OOC 出戏", "severity": "error", "detail": "问题描述", "evidence": "原文片段" }',
          '  ]',
          '}',
          '- severity 取 info / warn / error；没有问题时 issues 返回空数组',
          '- 每条 evidence 必须是正文中的原句片段，不得超过 40 字',
          '- 宁缺毋滥：只报你有充分把握的矛盾',
          JSON_ONLY
        ].join('\n')
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

/** 章节摘要 + 状态抽取（计划书 §12 `memory.summarize` / `memory.extract_state`） */
export function buildMemoryMessages(input: MemoryPromptInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_EXTRACTOR },
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
        [
          '【输出格式】输出一个 JSON 对象：',
          '{',
          '  "summary": "本章摘要，150 字以内，按发生顺序陈述关键事件与结果",',
          '  "characterStates": [',
          '    { "name": "角色名", "state": "身心/处境状态", "location": "当前所在地",',
          '      "power": "能力或战力变化", "items": ["持有道具"], "recent": "最近行为，30 字以内" }',
          '  ],',
          '  "continuityFacts": {',
          '    "worldState": "世界/局势当前状态的增量，80 字以内",',
          '    "timeline": "本章发生的时间点或与上章的时间间隔，40 字以内",',
          '    "resourceLedger": "资源/道具/数值的增减，60 字以内",',
          '    "facts": ["本章新增的、后续必须遵守的硬事实，每条 30 字以内"]',
          '  },',
          '  "threadUpdates": [',
          '    { "title": "伏笔或支线名称", "type": "plot|subplot|hook",',
          '      "event": "planted|progressing|resolved|abandoned", "evidence": "依据，30 字以内" }',
          '  ]',
          '}',
          '- characterStates 至少覆盖本章所有出场角色',
          '- threadUpdates 记录本章埋下或推进的伏笔；没有则返回空数组',
          '- 所有内容必须来自正文，不得虚构',
          JSON_ONLY
        ].join('\n')
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

/** 定点修复（计划书 §7.1 步骤 4 / §12 `fix.spot`）：只改问题句段，不整章重写 */
export function buildFixMessages(input: FixPromptInput): ChatMessage[] {
  const issueLines = input.issues
    .map((issue, index) => {
      const where = issue.paragraph !== undefined ? `（第 ${issue.paragraph + 1} 段）` : ''
      const quote = issue.evidence ? `｜原句：${issue.evidence}` : ''
      return `${index + 1}. 【${issue.dimension}】${where}${issue.detail}${quote}`
    })
    .join('\n')

  return [
    { role: 'system', content: SYSTEM_EDITOR },
    {
      role: 'user',
      content: [
        `【任务】对第 ${input.chapterNo} 章正文做「定点修复」：只修掉下面列出的问题，其余一字不动。`,
        [row('书名', input.bookTitle), row('题材', input.genre), row('本章标题', input.chapterTitle)]
          .filter(Boolean)
          .join('\n'),
        `【待修复问题】\n${issueLines || '（无）'}`,
        `【本章正文】\n${input.content.trim()}`,
        [
          '【修复要求】',
          '- 只修改与上述问题相关的句子或段落，情节、信息量、人物与对话内容保持不变',
          '- 不得整章重写、不得删减情节、不得新增设定',
          '- 保持原有分段与叙事视角',
          `- 输出修复后的完整正文；不要输出任何说明或差异标记；${NO_MARKDOWN}`
        ].join('\n')
      ].join('\n\n')
    }
  ]
}