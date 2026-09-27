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