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

function baseSections(c: ChapterPromptContext): string[] {
  return [projectSection(c), outlineSection(c), briefSection(c), previousSection(c)].filter(Boolean)
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