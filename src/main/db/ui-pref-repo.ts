import { eq } from 'drizzle-orm'
import { getDb } from './client'
import { uiPref } from './schema'

/**
 * M13：UI 偏好持久化（键值对）。
 *
 * 值统一存字符串（JSON 由渲染层序列化）；键形如 layout:<projectId> /
 * layout:default / cmd:usage / toolbar:pin。是「习惯画像」的唯一落库载体，
 * 因此 resetUiPrefs 用于「重置习惯画像」。
 */

/** 读取全部偏好，返回「键 → 字符串值」映射 */
export function listUiPrefs(): Record<string, string> {
  const rows = getDb().select({ key: uiPref.key, value: uiPref.value }).from(uiPref).all()
  const result: Record<string, string> = {}
  for (const row of rows) result[row.key] = row.value
  return result
}

/** 写入偏好（upsert）：同键覆盖并刷新 updated_at */
export function setUiPref(key: string, value: string): void {
  const now = Date.now()
  getDb()
    .insert(uiPref)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: uiPref.key, set: { value, updatedAt: now } })
    .run()
}

/** 删除单个偏好键 */
export function removeUiPref(key: string): void {
  getDb().delete(uiPref).where(eq(uiPref.key, key)).run()
}

/** 清空全部偏好（用于「重置习惯画像」） */
export function resetUiPrefs(): void {
  getDb().delete(uiPref).run()
}
