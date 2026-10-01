import { app } from 'electron'
import type { PackExportInput, PackImportResult, ThemePack } from '@shared/types'
import { DEFAULT_REQUIRED_FIELDS } from '../import/outline/patterns'
import { listPromptTemplates, savePromptTemplate } from '../prompts/registry'

/**
 * M11 · 题材包（计划书 §5.4）
 *
 * 一个可分享的 `.inkwell-pack.json`：题材模板 + 提示词覆写 + 导入校验必填字段。
 * 导出端只负责「打包」（纯函数，便于自检与单元测试）；
 * 导入端做严格校验后落库：提示词覆写逐条 savePromptTemplate，
 * 题材由渲染层落库（主进程只统计数量，避免与 renderer/data/genres.ts 重复）。
 */

/** 与渲染层 data/genres.ts 的结构保持一致（shared/types.ts 未单独导出该类型） */
export type GenreTemplate = { name: string; chapters: number; style: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`题材包字段类型错误：${field} 应为字符串`)
  return value
}

/** 打包：题材模板 + 当前被覆写过的提示词 + 默认必填字段模板 */
export function buildThemePack(input: PackExportInput & { genres?: GenreTemplate[] }): ThemePack {
  const includePrompts = input.includePrompts !== false
  const promptOverrides = includePrompts
    ? listPromptTemplates()
        .filter((item) => item.overridden)
        .map((item) => ({ key: item.key, system: item.system, instruction: item.instruction }))
    : []

  return {
    packVersion: 1,
    name: input.name,
    description: input.description ?? '',
    appVersion: app.getVersion(),
    exportedAt: Date.now(),
    genres: (input.genres ?? []).map((genre) => ({
      name: String(genre.name),
      chapters: Number(genre.chapters),
      style: String(genre.style)
    })),
    promptOverrides,
    requiredFields: [...DEFAULT_REQUIRED_FIELDS]
  }
}

/**
 * 导入：严格校验（packVersion 必须为 1，逐字段校类型，非法包抛中文错误）。
 * - 提示词覆写逐条保存；未知 key 由 registry 抛错，跳过该条而不是整体失败；
 * - 题材只统计数量（由渲染层落库）；
 * - requiredFields 回填为「,」连接的字符串，缺省用 DEFAULT_REQUIRED_FIELDS。
 */
export function applyThemePack(pack: unknown): PackImportResult {
  if (!isRecord(pack)) throw new Error('题材包格式错误：应为 JSON 对象')
  if (pack.packVersion !== 1) {
    throw new Error(`不支持的题材包版本：${String(pack.packVersion)}（当前仅支持 packVersion=1）`)
  }

  const name = requireString(pack.name, 'name').trim()
  if (!name) throw new Error('题材包缺少包名（name）')

  if (pack.description !== undefined) requireString(pack.description, 'description')
  if (pack.appVersion !== undefined) requireString(pack.appVersion, 'appVersion')
  if (pack.exportedAt !== undefined && typeof pack.exportedAt !== 'number') {
    throw new Error('题材包字段类型错误：exportedAt 应为数字')
  }

  if (!Array.isArray(pack.genres)) throw new Error('题材包字段类型错误：genres 应为数组')
  const genres = pack.genres.map((item, index) => {
    if (!isRecord(item)) throw new Error(`题材包字段类型错误：genres[${index}] 应为对象`)
    const genreName = requireString(item.name, `genres[${index}].name`).trim()
    if (typeof item.chapters !== 'number' || !Number.isFinite(item.chapters)) {
      throw new Error(`题材包字段类型错误：genres[${index}].chapters 应为数字`)
    }
    const style = requireString(item.style, `genres[${index}].style`)
    return { name: genreName, chapters: item.chapters, style }
  })

  if (!Array.isArray(pack.promptOverrides)) throw new Error('题材包字段类型错误：promptOverrides 应为数组')
  const overrides = pack.promptOverrides.map((item, index) => {
    if (!isRecord(item)) throw new Error(`题材包字段类型错误：promptOverrides[${index}] 应为对象`)
    return {
      key: requireString(item.key, `promptOverrides[${index}].key`),
      system: requireString(item.system, `promptOverrides[${index}].system`),
      instruction: requireString(item.instruction, `promptOverrides[${index}].instruction`)
    }
  })

  let requiredFields: string[] = []
  if (pack.requiredFields !== undefined) {
    if (!Array.isArray(pack.requiredFields)) {
      throw new Error('题材包字段类型错误：requiredFields 应为字符串数组')
    }
    requiredFields = pack.requiredFields.map((item, index) => requireString(item, `requiredFields[${index}]`))
  }
  if (requiredFields.length === 0) requiredFields = [...DEFAULT_REQUIRED_FIELDS]

  let promptsApplied = 0
  for (const override of overrides) {
    try {
      savePromptTemplate({ key: override.key, system: override.system, instruction: override.instruction })
      promptsApplied += 1
    } catch {
      // 未知 key（registry 抛错）或写库失败：跳过该条，不影响其余条目
    }
  }

  return {
    name,
    genresAdded: genres.length,
    promptsApplied,
    requiredFields: requiredFields.join(','),
    // 渲染层需要拿到题材列表才能落到本地存储并合并进「新建项目」的题材下拉
    genres: genres.map((item) => ({ name: item.name, chapters: item.chapters, style: item.style }))
  }
}
