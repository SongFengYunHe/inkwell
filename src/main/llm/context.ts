import type { ChapterBrief, ChapterDraft, Project } from '@shared/types'
import { getProject, listBriefs, listDrafts } from '../db/repositories'
import type { ChapterPromptContext } from '../prompts/zh-CN'

const PREVIOUS_EXCERPT_CHARS = 800

/** 取文本末尾若干字符，尽量从段落边界开始，保证前情提要可读 */
export function tailExcerpt(content: string, max: number): string {
  const text = content.trim()
  if (text.length <= max) return text
  const slice = text.slice(text.length - max)
  const breakIndex = slice.indexOf('\n')
  return breakIndex >= 0 && breakIndex < slice.length - 1 ? slice.slice(breakIndex + 1) : slice
}

export interface ChapterContextBundle {
  project: Project
  brief: ChapterBrief | null
  latestDraft: ChapterDraft | null
  previousDraft: ChapterDraft | null
  context: ChapterPromptContext
}

/**
 * 装配单章上下文（计划书 §7.1 的「装配」步骤）。
 * 纯数据库逻辑、不依赖 Electron，应用与 MCP Server 共用。
 */
export function buildChapterContext(projectId: number, chapterNo: number): ChapterContextBundle | null {
  const project = getProject(projectId)
  if (!project) return null

  const brief = listBriefs(projectId).find((item) => item.chapterNo === chapterNo) ?? null
  const drafts = listDrafts(projectId)
  const latestDraft = drafts.find((item) => item.chapterNo === chapterNo) ?? null
  const previousDraft = drafts.find((item) => item.chapterNo === chapterNo - 1) ?? null

  return {
    project,
    brief,
    latestDraft,
    previousDraft,
    context: {
      bookTitle: project.name,
      genre: project.genre,
      premise: project.premise,
      worldbuilding: project.worldbuilding,
      protagonist: project.protagonist,
      goldenFinger: project.goldenFinger,
      style: project.style,
      globalGuidance: project.globalGuidance,
      coreOutline: project.coreOutline,
      chapterNo,
      chapterTitle: brief?.title ?? '',
      purpose: brief?.purpose ?? '',
      keyEvents: brief?.keyEvents ?? '',
      characters: brief?.characters ?? [],
      sceneBeats: brief?.sceneBeats ?? [],
      suspenseHook: brief?.suspenseHook ?? '',
      userGuidance: brief?.userGuidance ?? '',
      previousExcerpt: previousDraft ? tailExcerpt(previousDraft.content, PREVIOUS_EXCERPT_CHARS) : '',
      existingContent: latestDraft?.content ?? '',
      targetWords: project.wordsPerChapter
    }
  }
}