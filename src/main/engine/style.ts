import { eq } from 'drizzle-orm'
import type { Project, StyleProfile, StyleProfileGenerateInput } from '@shared/types'
import { getDb } from '../db/client'
import { project } from '../db/schema'
import { getProject, listDrafts } from '../db/repositories'
import { buildStyleProfileMessages } from '../prompts/zh-CN'
import { invokeJson } from '../llm/invoke'
import { styleProfileDraftSchema } from '../llm/schemas'

/**
 * A2 文风仿写画像（计划书 §12 style.profile）。
 *
 * 定位：把「文风」从一句话（project.style）升级成一份可执行清单。
 * 画像会被注入每一章的写作提示词（【文风画像（必须遵守）】），
 * 也可以由用户从已有正文里自动抽取样本后生成——写得越久越贴合自己的笔调。
 */

/** 从本书已有正文里摘样本：优先取最近写完的章节，最多 maxChars 字 */
export function sampleFromProject(projectId: number, maxChars = 4000): string {
  const drafts = listDrafts(projectId)
    .filter((draft) => draft.content.trim().length > 0)
    .sort((a, b) => b.chapterNo - a.chapterNo)
    .slice(0, 3)

  const parts: string[] = []
  let used = 0
  for (const draft of drafts.reverse()) {
    const remaining = maxChars - used
    if (remaining <= 200) break
    const text = draft.content.trim().slice(0, remaining)
    parts.push('（第 ' + draft.chapterNo + ' 章）\n' + text)
    used += text.length
  }
  return parts.join('\n\n')
}

/** 读取画像（解析失败按「没有画像」处理，绝不让脏数据卡住写作） */
export function getStyleProfile(projectId: number): StyleProfile | null {
  const row = getDb()
    .select({ raw: project.styleProfile })
    .from(project)
    .where(eq(project.id, projectId))
    .get()
  const raw = row?.raw?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StyleProfile>
    return {
      summary: parsed.summary ?? '',
      tone: parsed.tone ?? '',
      pov: parsed.pov ?? '',
      sentence: parsed.sentence ?? '',
      diction: parsed.diction ?? '',
      dialogue: parsed.dialogue ?? '',
      imagery: parsed.imagery ?? '',
      pacing: parsed.pacing ?? '',
      taboos: Array.isArray(parsed.taboos) ? parsed.taboos : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      samples: Array.isArray(parsed.samples) ? parsed.samples : [],
      source: parsed.source ?? '',
      updatedAt: parsed.updatedAt ?? 0
    }
  } catch {
    return null
  }
}

export function saveStyleProfile(projectId: number, profile: StyleProfile): StyleProfile {
  getDb()
    .update(project)
    .set({ styleProfile: JSON.stringify(profile), updatedAt: Date.now() })
    .where(eq(project.id, projectId))
    .run()
  return profile
}

export function clearStyleProfile(projectId: number): void {
  getDb()
    .update(project)
    .set({ styleProfile: '', updatedAt: Date.now() })
    .where(eq(project.id, projectId))
    .run()
}

/** 把结构化画像渲染成提示词段落（只输出非空项，避免塞一堆空标题） */
export function renderStyleProfile(profile: StyleProfile | null): string {
  if (!profile) return ''
  const rows: string[] = []
  const push = (label: string, value: string): void => {
    if (value.trim()) rows.push(label + '：' + value.trim())
  }
  push('总体', profile.summary)
  push('语气基调', profile.tone)
  push('叙事视角', profile.pov)
  push('句式节奏', profile.sentence)
  push('用词偏好', profile.diction)
  push('对话特征', profile.dialogue)
  push('意象与比喻', profile.imagery)
  push('段落节奏', profile.pacing)
  if (profile.keywords.length > 0) push('标志性用词', profile.keywords.join('、'))
  if (profile.samples.length > 0) push('代表句', profile.samples.join(' ／ '))
  if (profile.taboos.length > 0) push('必须避免', profile.taboos.join('；'))
  return rows.join('\n')
}

/** 供上下文装配直接使用：读画像 + 渲染成段落 */
export function styleProfileForPrompt(projectId: number): string {
  try {
    return renderStyleProfile(getStyleProfile(projectId))
  } catch {
    return ''
  }
}

/** 生成画像：样本来自用户粘贴或本书已有正文 */
export async function generateStyleProfile(
  input: StyleProfileGenerateInput & { signal?: AbortSignal }
): Promise<StyleProfile> {
  const row: Project | null = getProject(input.projectId)
  if (!row) throw new Error('项目不存在：' + input.projectId)

  const pasted = input.sample?.trim() ?? ''
  const sample = pasted.length > 0 ? pasted.slice(0, 12000) : sampleFromProject(input.projectId)
  if (!sample.trim()) {
    throw new Error('没有可用于分析的样本文本：请粘贴一段参考文本，或先写几章正文')
  }

  const draft = await invokeJson(
    {
      role: 'architect',
      messages: buildStyleProfileMessages({
        bookTitle: row.name,
        genre: row.genre,
        sample
      }),
      signal: input.signal,
      temperature: 0.3
    },
    (raw) => styleProfileDraftSchema.parse(raw)
  )

  const origin = pasted.length > 0 ? '用户粘贴的参考文本' : '本书已有正文自动摘取'
  return saveStyleProfile(input.projectId, {
    ...draft,
    source: origin + '｜样本 ' + sample.length + ' 字｜' + new Date().toLocaleString('zh-CN'),
    updatedAt: Date.now()
  })
}
