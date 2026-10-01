import type { DayStat } from '@shared/types'
import { getRawSqlite } from '../db/client'

/**
 * 写作统计读写（writing_stat）。
 *
 * 口径（见 M8 规格 §5.3）：
 * - 字数增量在**草稿保存时按差值累加**：delta = 本次 wordCount − 上次 wordCount。
 *   新建草稿视为 delta = wordCount；重写 / 精简会得到负数，一并累加（可扣减）。
 * - 「章节完成数」按「该章首次出现非空正文」记 +1（同一章多次改写不重复计），
 *   由 repositories.saveDraft 在写入前后对比判定后调用 addChaptersDone。
 * - 日期一律按**本地时区**的 YYYY-MM-DD 归集。
 *
 * 说明：这里用原生 SQL 以 `ON CONFLICT ... excluded` 做原子自增，
 *       避免 drizzle 在 DO UPDATE 子句里限定表名可能带来的解析歧义。
 */

/** 回溯上限，防止脏数据让 streak 计算陷入长循环 */
const MAX_STREAK_LOOKBACK = 3660

/** 本地时区的 YYYY-MM-DD */
export function dayKey(now: number = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 按自然日偏移取日键（基于本地日历日，避开夏令时导致的逐日累减误差） */
export function shiftDayKey(key: string, offsetDays: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, (month ?? 1) - 1, day ?? 1)
  date.setDate(date.getDate() + offsetDays)
  return dayKey(date.getTime())
}

/** 累加今日字数增量（可正可负） */
export function addWords(delta: number, now: number = Date.now()): void {
  if (!delta) return
  getRawSqlite()
    .prepare(
      `INSERT INTO writing_stat (day, words_added, chapters_done, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(day) DO UPDATE SET
         words_added = words_added + excluded.words_added,
         updated_at = excluded.updated_at`
    )
    .run(dayKey(now), delta, now)
}

/** 累加今日完成章数 */
export function addChaptersDone(delta: number, now: number = Date.now()): void {
  if (!delta) return
  getRawSqlite()
    .prepare(
      `INSERT INTO writing_stat (day, words_added, chapters_done, updated_at)
       VALUES (?, 0, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         chapters_done = chapters_done + excluded.chapters_done,
         updated_at = excluded.updated_at`
    )
    .run(dayKey(now), delta, now)
}

/** 读取某天的统计（无记录时返回 0） */
export function getDayStat(day: string): DayStat {
  const row = getRawSqlite()
    .prepare('SELECT day, words_added AS wordsAdded, chapters_done AS chaptersDone FROM writing_stat WHERE day = ?')
    .get(day) as DayStat | undefined
  return row ?? { day, wordsAdded: 0, chaptersDone: 0 }
}

/** 最近 N 天（含今天，按时间升序） */
export function recentDays(days: number, now: number = Date.now()): DayStat[] {
  const today = dayKey(now)
  const result: DayStat[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    result.push(getDayStat(shiftDayKey(today, -offset)))
  }
  return result
}

/**
 * 连续达标天数（按每日字数目标）。
 * 口径：从今天往前数；若今天尚未达标，则从昨天起算（今天还在进行中，不算断签）。
 * 一旦某天未达标即停止计数。目标 ≤ 0 时恒为 0（避免「全达标」的无穷 streak）。
 */
export function getStreak(goalWords: number, now: number = Date.now()): number {
  if (goalWords <= 0) return 0
  const stmt = getRawSqlite().prepare('SELECT words_added AS wordsAdded FROM writing_stat WHERE day = ?')
  let day = dayKey(now)
  const todayWords = (stmt.get(day) as { wordsAdded: number } | undefined)?.wordsAdded ?? 0
  if (todayWords < goalWords) day = shiftDayKey(day, -1)

  let streak = 0
  for (let i = 0; i < MAX_STREAK_LOOKBACK; i += 1) {
    const words = (stmt.get(day) as { wordsAdded: number } | undefined)?.wordsAdded ?? 0
    if (words < goalWords) break
    streak += 1
    day = shiftDayKey(day, -1)
  }
  return streak
}