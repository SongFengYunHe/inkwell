import { and, eq } from 'drizzle-orm'
import type { PromptTemplateInfo } from '@shared/types'
import { getDb } from '../db/client'
import { promptTemplate } from '../db/schema'

/**
 * A1 可覆写提示词模板（计划书 §12「关键提示词资产」）。
 *
 * 设计要点：
 *   - 内置默认（defaultSystem / defaultInstruction）随代码升级自动更新；
 *   - 数据库 prompt_template 只存「被用户改过的」行，缺行即用内置默认，
 *     因此老库不会因为内置模板迭代而拿到过期副本；
 *   - 模板正文用 {{变量}} 占位，未知变量原样保留（便于用户看到自己写错了）；
 *   - 覆写按进程缓存，保存 / 重置后失效；MCP 独立进程各自持有一份缓存。
 */

export const PROMPT_LOCALE = 'zh-CN'

export interface PromptTemplateDef {
  key: string
  title: string
  category: string
  description: string
  variables: string[]
  /** 系统提示词（角色设定） */
  system: string
  /** 用户消息里的指令块（可用 {{变量}}） */
  instruction: string
}

const SYSTEM_WRITER = [
  '你是一位深耕中文网络文学多年的职业作家，擅长长篇连载。',
  '你的文字画面感强、节奏稳、对话自然，善于用具体细节推进剧情。',
  '你严格遵循给定的世界观、人物设定与大纲，绝不发明与之冲突的设定。'
].join('\n')

const SYSTEM_EDITOR =
  '你是一位资深中文小说编辑，擅长在不改动情节与信息量的前提下，提升文字的准确度、节奏与感染力。'

const SYSTEM_PLANNER = [
  '你是一位资深中文网络小说策划，擅长把一句话灵感扩展成可连载的长篇设定与总大纲，',
  '并把总大纲拆成节奏合理、环环相扣的逐章细纲。',
  '你只输出 JSON，绝不输出任何解释性文字。'
].join('\n')

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

const SYSTEM_IMPORT_PARSER = [
  '你是一位中文小说大纲结构整理员。',
  '你从一段「未标注」的章节大纲文本中，识别出本章目的、关键事件、出场角色、场景节拍与悬念钩子。',
  '只依据给定文本，不虚构原文没有的信息；某项在文本中确实没有就留空。',
  '你只输出 JSON，绝不输出任何解释性文字。'
].join('\n')

const SYSTEM_STYLE_ANALYST = [
  '你是一位中文小说文体分析师，擅长从样本文本中提炼可复用的"文风画像"。',
  '你只依据样本本身的证据说话：句式、节奏、用词、对话、意象、视角。',
  '你只输出 JSON，绝不输出任何解释性文字。'
].join('\n')

const JSON_ONLY = '只输出 JSON 本身：不要 Markdown 代码块，不要前后缀解释，不要注释。'

/** 各模板的默认正文（用户可在「设置 · 提示词」逐条覆写） */
export const PROMPT_TEMPLATES: PromptTemplateDef[] = [
  {
    key: 'chapter.draft',
    title: '正文起草（细纲 → 正文）',
    category: '创作',
    description: '按细纲写出整章正文。作品设定 / 细纲 / 记忆 / 前情由程序自动装配在消息前部。',
    variables: ['chapterNo', 'targetWords', 'noMarkdown'],
    system: SYSTEM_WRITER,
    instruction: [
      '【写作要求】',
      '- 写出第 {{chapterNo}} 章完整正文，约 {{targetWords}} 字（允许 ±20% 浮动）',
      '- 落到具体场景与人物动作，避免空洞概述与总结式叙述',
      '- 章末扣住「悬念钩子」，留下继续读下去的动力',
      '- {{noMarkdown}}'
    ].join('\n')
  },
  {
    key: 'chapter.continue',
    title: '续写（接着已有正文往下写）',
    category: '创作',
    description: '承接本章已写内容继续写；已有正文由程序附在消息里。',
    variables: ['chapterNo', 'targetWords', 'noMarkdown'],
    system: SYSTEM_WRITER,
    instruction: [
      '【写作要求】',
      '- 承接上文继续写下去，新写约 {{targetWords}} 字',
      '- 人称、时态、语气、称谓必须与上文完全一致',
      '- 只输出新续写的正文，绝不要重复已有内容，也不要重复开头',
      '- {{noMarkdown}}'
    ].join('\n')
  },
  {
    key: 'chapter.rewrite',
    title: '重写本章',
    category: '创作',
    description: '按细纲重写整章；当前正文作为参考附在消息里。',
    variables: ['chapterNo', 'targetWords', 'noMarkdown'],
    system: SYSTEM_WRITER,
    instruction: [
      '【写作要求】',
      '- 按上面的细纲重新撰写第 {{chapterNo}} 章完整正文，约 {{targetWords}} 字',
      '- 情节走向与设定必须与当前版本一致，但叙事视角、场景调度与细节描写要明显提升',
      '- {{noMarkdown}}'
    ].join('\n')
  },
  {
    key: 'chapter.polish',
    title: '润色（只改文字，不改情节）',
    category: '创作',
    description: '在不改情节与信息量的前提下提升文字质量。',
    variables: ['chapterNo', 'noMarkdown'],
    system: SYSTEM_EDITOR,
    instruction: [
      '【润色要求】',
      '- 情节、人物、对话内容与信息量保持不变，只改善文字表达',
      '- 消除 AI 腔：减少空洞排比、套话与重复用词，让句子更有呼吸感',
      '- 输出润色后的完整正文，不要输出任何修改说明',
      '- {{noMarkdown}}'
    ].join('\n')
  },
  {
    key: 'outline.generate',
    title: '一句话灵感 → 设定 + 总大纲',
    category: '策划',
    description: '新建向导第一步使用的提示词。',
    variables: ['bookTitle', 'genre', 'totalChapters', 'wordsPerChapter', 'premise'],
    system: SYSTEM_PLANNER,
    instruction: [
      '【任务】把下面的一句话灵感扩展为一部长篇小说的设定与总大纲。',
      '书名：{{bookTitle}}',
      '题材：{{genre}}',
      '预计章数：{{totalChapters}}',
      '单章目标字数：{{wordsPerChapter}}',
      '一句话灵感：{{premise}}',
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
  },
  {
    key: 'brief.batch',
    title: '总大纲 → 逐章细纲（批量）',
    category: '策划',
    description: '按区间批量生成细纲；书名 / 世界观 / 总大纲等由程序附在消息前部。',
    variables: ['fromChapter', 'toChapter', 'count', 'bookTitle', 'genre'],
    system: SYSTEM_PLANNER,
    instruction: [
      '【任务】基于总大纲，为第 {{fromChapter}} 章到第 {{toChapter}} 章逐章编写细纲。',
      '【输出格式】输出一个 JSON 数组，共 {{count}} 项，chapterNo 依次为 {{fromChapter}} 到 {{toChapter}}：',
      '[',
      '  {',
      '    "chapterNo": {{fromChapter}},',
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
  },
  {
    key: 'brief.expand',
    title: '单章细纲补全 / 强化',
    category: '策划',
    description: '对某一章细纲做补全；当前细纲由程序附在消息里。',
    variables: ['chapterNo'],
    system: SYSTEM_PLANNER,
    instruction: [
      '【任务】补全并强化第 {{chapterNo}} 章的细纲。',
      '【输出格式】输出一个 JSON 对象：',
      '{',
      '  "chapterNo": {{chapterNo}},',
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
  },
  {
    key: 'audit.consistency',
    title: '一致性审计（语义维度）',
    category: '审稿',
    description: '对照真相文件检查 OOC / 设定冲突 / 时间线 / 伏笔 / 称谓；正文由程序附在消息里。',
    variables: ['bookTitle', 'genre', 'chapterNo'],
    system: SYSTEM_REVIEWER,
    instruction: [
      '【任务】对照"真相文件"，对第 {{chapterNo}} 章正文做一致性审计，只报告**明确可证实的矛盾**。',
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
  },
  {
    key: 'fix.spot',
    title: '定点修复（只改问题句段）',
    category: '审稿',
    description: '一键修复用的提示词；问题清单与正文由程序附在消息里。',
    variables: ['chapterNo', 'noMarkdown'],
    system: SYSTEM_EDITOR,
    instruction: [
      '【任务】对第 {{chapterNo}} 章正文做「定点修复」：只修掉下面列出的问题，其余一字不动。',
      '【修复要求】',
      '- 只修改与上述问题相关的句子或段落，情节、信息量、人物与对话内容保持不变',
      '- 不得整章重写、不得删减情节、不得新增设定',
      '- 保持原有分段与叙事视角',
      '- 输出修复后的完整正文；不要输出任何说明或差异标记；{{noMarkdown}}'
    ].join('\n')
  },
  {
    key: 'memory.summarize',
    title: '章节记忆回写（摘要 + 状态抽取）',
    category: '记忆',
    description: '每章落盘后生成摘要、角色状态增量与伏笔进展；正文由程序附在消息里。',
    variables: ['chapterNo'],
    system: SYSTEM_EXTRACTOR,
    instruction: [
      '【任务】为第 {{chapterNo}} 章正文建立记忆快照。',
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
  },
  {
    key: 'import.extract_brief',
    title: '导入解析兜底（未标注段落 → 结构化字段）',
    category: '导入',
    description: '仅对规则未命中的章内块调用（默认关闭）；原文由程序附在消息里。',
    variables: ['chapterNo'],
    system: SYSTEM_IMPORT_PARSER,
    instruction: [
      '【任务】把下面这段未标注的章节大纲整理成结构化字段。',
      '【输出格式】输出一个 JSON 对象：',
      '{',
      '  "purpose": "本章目的，60 字以内",',
      '  "keyEvents": "关键事件，120 字以内",',
      '  "characters": ["出场角色"],',
      '  "sceneBeats": ["场景节拍"],',
      '  "suspenseHook": "章末悬念钩子，40 字以内"',
      '}',
      '- 文本中没有的信息留空字符串 / 空数组，不要编造',
      JSON_ONLY
    ].join('\n')
  },
  {
    key: 'style.profile',
    title: '文风仿写画像（样本 → 结构化画像）',
    category: '文风',
    description: 'A2：从参考文本提炼文风画像，画像会作为「必须遵守」注入每一章的写作提示词。',
    variables: ['bookTitle', 'genre', 'sampleChars'],
    system: SYSTEM_STYLE_ANALYST,
    instruction: [
      '【任务】分析下面这段参考文本（约 {{sampleChars}} 字），提炼出可复用的"文风画像"。',
      '书名：{{bookTitle}}｜题材：{{genre}}',
      '【输出格式】输出一个 JSON 对象：',
      '{',
      '  "summary": "一句话概括这种文风（60 字以内）",',
      '  "tone": "情绪基调与叙述态度（40 字以内）",',
      '  "pov": "叙事视角与人称（40 字以内）",',
      '  "sentence": "句式特征：长短句比例、节奏、断句习惯（80 字以内）",',
      '  "diction": "用词偏好：口语/书面、古雅/现代、方言与行业词（80 字以内）",',
      '  "dialogue": "对话特征：比例、语气、是否用对话推进剧情（80 字以内）",',
      '  "imagery": "意象与比喻习惯（80 字以内）",',
      '  "pacing": "段落与场景节奏：段落长度、切换频率（80 字以内）",',
      '  "taboos": ["应当避免的写法，例如滥用排比 / 空洞抒情，3-6 条"],',
      '  "keywords": ["标志性高频用词或专属名词，5-12 个"],',
      '  "samples": ["最能代表该文风的原句，2-3 条，逐字摘录"]',
      '}',
      '- 必须基于样本证据，不要输出"文笔优美"之类的空话',
      JSON_ONLY
    ].join('\n')
  }
]

const DEF_BY_KEY = new Map(PROMPT_TEMPLATES.map((item) => [item.key, item]))

export function findPromptTemplate(key: string): PromptTemplateDef {
  const def = DEF_BY_KEY.get(key)
  if (!def) throw new Error(`未知提示词模板：${key}`)
  return def
}

/** 占位符替换：{{name}}；未提供的变量原样保留 */
export function renderPrompt(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  )
}

interface Override {
  system: string
  instruction: string
}

let cache: Map<string, Override> | null = null

/** 读取覆写层（缺表 / 未初始化时安全回退到内置默认） */
function overrides(): Map<string, Override> {
  if (cache) return cache
  const map = new Map<string, Override>()
  try {
    const rows = getDb().select().from(promptTemplate).where(eq(promptTemplate.locale, PROMPT_LOCALE)).all()
    for (const row of rows) {
      map.set(row.key, { system: row.systemBody, instruction: row.instructionBody })
    }
  } catch {
    // 数据库尚未初始化：用内置默认
  }
  cache = map
  return map
}

export function invalidatePromptCache(): void {
  cache = null
}

export interface RenderedPrompt {
  system: string
  instruction: string
}

/** 取最终生效的提示词（覆写优先，其次内置默认），并完成变量替换 */
export function resolvePrompt(key: string, vars: Record<string, string | number> = {}): RenderedPrompt {
  const def = findPromptTemplate(key)
  const override = overrides().get(key)
  const system = override?.system?.trim() ? override.system : def.system
  const instruction = override?.instruction?.trim() ? override.instruction : def.instruction
  return { system: renderPrompt(system, vars), instruction: renderPrompt(instruction, vars) }
}

export function listPromptTemplates(): PromptTemplateInfo[] {
  const override = overrides()
  return PROMPT_TEMPLATES.map((def) => {
    const row = override.get(def.key)
    return {
      key: def.key,
      title: def.title,
      category: def.category,
      description: def.description,
      variables: def.variables,
      system: row?.system?.trim() ? row.system : def.system,
      instruction: row?.instruction?.trim() ? row.instruction : def.instruction,
      defaultSystem: def.system,
      defaultInstruction: def.instruction,
      overridden: Boolean(row && (row.system.trim() || row.instruction.trim())),
      updatedAt: null
    }
  })
}

/** 保存覆写（空字符串表示该项沿用内置默认） */
export function savePromptTemplate(input: {
  key: string
  system?: string
  instruction?: string
}): PromptTemplateInfo {
  const def = findPromptTemplate(input.key)
  const now = Date.now()
  const system = (input.system ?? '').slice(0, 200_000)
  const instruction = (input.instruction ?? '').slice(0, 200_000)
  const db = getDb()
  const existing = db
    .select()
    .from(promptTemplate)
    .where(eq(promptTemplate.key, def.key))
    .all()
    .find((row) => row.locale === PROMPT_LOCALE)

  const overridden = Boolean(system.trim() || instruction.trim())
  if (!existing) {
    if (overridden) {
      db.insert(promptTemplate)
        .values({
          key: def.key,
          locale: PROMPT_LOCALE,
          systemBody: system,
          instructionBody: instruction,
          version: 1,
          updatedAt: now
        })
        .run()
    }
  } else if (!overridden) {
    // 清空即视为恢复默认：直接删掉覆写行
    db.delete(promptTemplate)
      .where(and(eq(promptTemplate.key, def.key), eq(promptTemplate.locale, PROMPT_LOCALE)))
      .run()
  } else {
    db.update(promptTemplate)
      .set({
        systemBody: system,
        instructionBody: instruction,
        version: existing.version + 1,
        updatedAt: now
      })
      .where(and(eq(promptTemplate.key, def.key), eq(promptTemplate.locale, PROMPT_LOCALE)))
      .run()
  }
  invalidatePromptCache()
  return listPromptTemplates().find((item) => item.key === def.key)!
}

/** 恢复某条模板的内置默认（删除覆写行） */
export function resetPromptTemplate(key: string): PromptTemplateInfo {
  const def = findPromptTemplate(key)
  getDb()
    .delete(promptTemplate)
    .where(and(eq(promptTemplate.key, def.key), eq(promptTemplate.locale, PROMPT_LOCALE)))
    .run()
  invalidatePromptCache()
  return listPromptTemplates().find((item) => item.key === def.key)!
}
