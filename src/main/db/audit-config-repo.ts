import { eq } from 'drizzle-orm'
import type { AuditConfig, AuditConfigSaveInput } from '@shared/types'
import { getDb } from './client'
import { auditConfig } from './schema'

/**
 * M10 §4.2 审计维度可配置（计划书 v1.2）。
 *
 * 单行表（id = 1）：维度开关 / 严重度阈值 / warn 是否算不通过。
 * 所有读接口都必须容错——表不存在、库未就绪、JSON 脏数据时一律回落到默认值，
 * 绝不让设置页或整本审计因为一条配置读不出来而崩掉。
 */

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  disabledDimensions: [],
  minSeverity: 'warn',
  countWarnAsFail: false,
  updatedAt: null
}

/**
 * 与 engine/audit.ts `deterministicAudit` 产出的维度名逐字对齐（设置页开关依据）。
 * 这些字符串同时是 disabledDimensions 的匹配键，改名等于让用户的开关失效。
 */
export const DETERMINISTIC_AUDIT_DIMENSIONS: readonly string[] = [
  '字数达标',
  '无 Markdown 残留',
  '无章节标题行',
  '无 AI 腔套话',
  '细纲角色均出场',
  '关键事件已覆盖',
  '悬念钩子有呼应',
  '段落长度适中',
  '无相邻重复句',
  '与前章不重复',
  '口头禅密度不超标',
  '章节有收尾段',
  '无排比堆砌',
  '标点使用规范'
]

/** 语义维度（reviewer 角色产出）：聚合项 + 注册表里约定的 5 类 */
export const SEMANTIC_AUDIT_DIMENSIONS: readonly string[] = [
  '语义审计（OOC / 设定 / 时间线 / 伏笔 / 称谓）',
  '语义·OOC 出戏',
  '语义·设定冲突',
  '语义·时间线矛盾',
  '语义·伏笔断线',
  '语义·称谓不一致'
]

/** 全部可用维度名（确定性 14 项 + 语义 6 项），供设置页渲染开关 */
export function listAuditDimensions(): string[] {
  return [...DETERMINISTIC_AUDIT_DIMENSIONS, ...SEMANTIC_AUDIT_DIMENSIONS]
}

function isSeverity(value: unknown): value is AuditConfig['minSeverity'] {
  return value === 'info' || value === 'warn' || value === 'error'
}

/** 清洗维度数组：去空、去重、去非字符串 */
function cleanDimensions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return [...new Set(cleaned)]
}

/** 读取配置；表不存在 / 读失败 / 无行时返回默认值 */
export function getAuditConfig(): AuditConfig {
  try {
    const row = getDb().select().from(auditConfig).where(eq(auditConfig.id, 1)).get()
    if (!row) return { ...DEFAULT_AUDIT_CONFIG, disabledDimensions: [] }
    return {
      disabledDimensions: cleanDimensions(row.disabledDimensions),
      minSeverity: isSeverity(row.minSeverity) ? row.minSeverity : DEFAULT_AUDIT_CONFIG.minSeverity,
      countWarnAsFail: row.countWarnAsFail === true,
      updatedAt: row.updatedAt ?? null
    }
  } catch {
    return { ...DEFAULT_AUDIT_CONFIG, disabledDimensions: [] }
  }
}

/** 保存配置：以当前配置为底，只覆盖显式传入的字段；写入后返回落库结果 */
export function saveAuditConfig(input: AuditConfigSaveInput): AuditConfig {
  const db = getDb()
  const current = getAuditConfig()
  const now = Date.now()
  const next: AuditConfig = {
    disabledDimensions:
      input.disabledDimensions === undefined ? current.disabledDimensions : cleanDimensions(input.disabledDimensions),
    minSeverity: isSeverity(input.minSeverity) ? input.minSeverity : current.minSeverity,
    countWarnAsFail: input.countWarnAsFail === undefined ? current.countWarnAsFail : input.countWarnAsFail === true,
    updatedAt: now
  }

  const existing = db.select({ id: auditConfig.id }).from(auditConfig).where(eq(auditConfig.id, 1)).get()
  if (existing) {
    db.update(auditConfig)
      .set({
        disabledDimensions: next.disabledDimensions,
        minSeverity: next.minSeverity,
        countWarnAsFail: next.countWarnAsFail,
        updatedAt: next.updatedAt
      })
      .where(eq(auditConfig.id, 1))
      .run()
  } else {
    db.insert(auditConfig)
      .values({
        id: 1,
        disabledDimensions: next.disabledDimensions,
        minSeverity: next.minSeverity,
        countWarnAsFail: next.countWarnAsFail,
        createdAt: now,
        updatedAt: now
      })
      .run()
  }

  return next
}
