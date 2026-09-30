import type { CharacterCard, MemoryChapter, OutlineThread, TruthFiles } from '@shared/types'
import { listCharacters, listMemoryChapters, listThreads } from '../db/memory-repo'

const ROLLING_WINDOW = 3

/** 判断伏笔 / 支线是否仍待处理（未回收、未废弃） */
export function isPending(thread: OutlineThread): boolean {
  return thread.status !== 'resolved' && thread.status !== 'abandoned'
}

/**
 * 装配七个真相文件（计划书 §7.2）。
 * 全部由记忆表投影而来、只读、可随时从正文重算（§5.2）。
 */
export function getTruthFiles(projectId: number): TruthFiles {
  const memories = listMemoryChapters(projectId)
  const threads = listThreads(projectId)

  const roll = (pick: (memory: MemoryChapter) => string): string =>
    memories
      .filter((memory) => pick(memory).trim())
      .slice(-ROLLING_WINDOW)
      .map((memory) => pick(memory).trim())
      .join('\n')

  return {
    projectId,
    worldState: roll((memory) => memory.continuityFacts.worldState),
    characterMatrix: listCharacters(projectId),
    pendingHooks: threads.filter((thread) => isPending(thread) && thread.type !== 'subplot'),
    chapterSummaries: memories
      .filter((memory) => memory.summary.trim())
      .map((memory) => ({ chapterNo: memory.chapterNo, summary: memory.summary })),
    subplotBoard: threads.filter((thread) => thread.type === 'subplot'),
    timeline: roll((memory) => memory.continuityFacts.timeline),
    resourceLedger: roll((memory) => memory.continuityFacts.resourceLedger)
  }
}

/** 把角色矩阵压缩成提示词可用的文本（真相文件 2） */
export function renderCharacterStates(characters: CharacterCard[]): string {
  return characters
    .filter((item) => item.csState || item.csLocation || item.csPower || item.csRecent)
    .map((item) =>
      [
        `${item.name}`,
        item.csState ? `状态：${item.csState}` : '',
        item.csLocation ? `所在：${item.csLocation}` : '',
        item.csPower ? `能力：${item.csPower}` : '',
        item.csRecent ? `近况：${item.csRecent}` : ''
      ]
        .filter(Boolean)
        .join(' / ')
    )
    .join('\n')
}

/** 把待处理伏笔压缩成提示词可用的文本（真相文件 3） */
export function renderThreads(threads: OutlineThread[]): string {
  return threads
    .map((thread) => `${thread.title}（${thread.type} / ${thread.status}）${thread.intent ? `：${thread.intent}` : ''}`)
    .join('\n')
}

export interface TruthSnapshot {
  /** 角色矩阵文本 */
  characterStates: string
  /** 待处理伏笔文本 */
  pendingHooks: string
  /** 第 chapterNo 章之前的最近摘要链 */
  recentSummaries: string
  /** 前一章摘要 */
  previousSummary: string
}

/**
 * 取某一章写作前所需的真相文件快照：
 * 只包含该章之前已落盘的记忆，避免"提前引用未发生的剧情"。
 */
export function buildTruthSnapshot(projectId: number, chapterNo: number): TruthSnapshot {
  const memories = listMemoryChapters(projectId).filter((memory) => memory.chapterNo < chapterNo)
  const threads = listThreads(projectId).filter((thread) => isPending(thread))
  const previous = memories.find((memory) => memory.chapterNo === chapterNo - 1) ?? null

  return {
    characterStates: renderCharacterStates(listCharacters(projectId)),
    pendingHooks: renderThreads(threads),
    recentSummaries: memories
      .slice(-ROLLING_WINDOW)
      .map((memory) => `第${memory.chapterNo}章：${memory.summary}`)
      .join('\n'),
    previousSummary: previous?.summary ?? ''
  }
}