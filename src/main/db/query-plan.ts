import { getRawSqlite } from './client'

/**
 * M14-C：查询计划断言工具。
 *
 * 计划书 §3.3 要求「热点查询加索引」并把回归固化进自检：只看 SQL 写对不够，
 * 还要确认 SQLite 真的走了索引而不是全表扫描（数据量一大就退化成 O(n)）。
 * 这里暴露 `explainQuery` / `usesFullScan`，供 smoke:m14 对热点查询做断言。
 */
interface QueryPlanRow {
  id: number
  parent: number
  notused: number
  detail: string
}

/** 返回 EXPLAIN QUERY PLAN 的可读文本（多行以 " | " 连接） */
export function explainQuery(sql: string, params: unknown[] = []): string {
  const rows = getRawSqlite()
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params) as QueryPlanRow[]
  return rows.map((row) => row.detail).join(' | ')
}

/**
 * 是否发生了全表扫描。
 * `SCAN <table>` 表示逐行扫表；`SEARCH <table> USING INDEX ...` 才是走索引。
 */
export function usesFullScan(sql: string, params: unknown[] = []): boolean {
  return /\bSCAN\b/.test(explainQuery(sql, params))
}
