import type { StatSetGoalInput, StatSummary, WritingGoalSettings } from '@shared/types'
import { getRawSqlite } from '../db/client'
import { dayKey, getDayStat, getStreak, recentDays } from './tracker'

/** writing_goal 单行（id = 1）读写；迁移 v7 已插入默认行，这里再做一次防御性兜底。 */
const DEFAULT_GOAL: WritingGoalSettings = { dailyWords: 3000, dailyChapters: 1 }
const RECENT_DAYS = 7

export function getGoal(): WritingGoalSettings {
  const raw = getRawSqlite()
  const row = raw
    .prepare('SELECT daily_words AS dailyWords, daily_chapters AS dailyChapters FROM writing_goal WHERE id = 1')
    .get() as WritingGoalSettings | undefined
  if (row) return row

  raw
    .prepare(
      'INSERT OR IGNORE INTO writing_goal (id, daily_words, daily_chapters, created_at) VALUES (1, ?, ?, ?)'
    )
    .run(DEFAULT_GOAL.dailyWords, DEFAULT_GOAL.dailyChapters, Date.now())
  return { ...DEFAULT_GOAL }
}

export function setGoal(input: StatSetGoalInput): WritingGoalSettings {
  const current = getGoal()
  const next: WritingGoalSettings = {
    dailyWords: input.dailyWords ?? current.dailyWords,
    dailyChapters: input.dailyChapters ?? current.dailyChapters
  }
  getRawSqlite()
    .prepare('UPDATE writing_goal SET daily_words = ?, daily_chapters = ? WHERE id = 1')
    .run(next.dailyWords, next.dailyChapters)
  return next
}

/** 今日进度 + 目标 + 连续达标天数 */
export function getStatSummary(now: number = Date.now()): StatSummary {
  const goal = getGoal()
  return {
    today: getDayStat(dayKey(now)),
    goal,
    streak: getStreak(goal.dailyWords, now),
    recent: recentDays(RECENT_DAYS, now)
  }
}