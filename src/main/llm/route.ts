import type { LlmRoleName, Provider, RoleRoute, RoleRouteSaveInput } from '@shared/types'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { roleRoute } from '../db/schema'
import { getActiveProvider, getProviderById } from '../providers/store'

export const ALL_ROLES: LlmRoleName[] = ['architect', 'writer', 'reviewer', 'extractor', 'embedder']

type RouteRow = typeof roleRoute.$inferSelect

function toDto(row: RouteRow): RoleRoute {
  return {
    id: row.id,
    role: row.role as LlmRoleName,
    providerId: row.providerId,
    model: row.model,
    fallbackChain: row.fallbackChain ?? [],
    maxConcurrency: row.maxConcurrency,
    updatedAt: row.updatedAt
  }
}

export function listRoutes(): RoleRoute[] {
  return getDb().select().from(roleRoute).orderBy(asc(roleRoute.id)).all().map(toDto)
}

export function saveRoute(input: RoleRouteSaveInput): RoleRoute {
  const db = getDb()
  const now = Date.now()
  const values = {
    role: input.role,
    providerId: input.providerId,
    model: input.model ?? '',
    fallbackChain: (input.fallbackChain ?? []).slice(0, 5),
    maxConcurrency: Math.max(1, Math.min(8, Math.floor(input.maxConcurrency ?? 2))),
    updatedAt: now
  }

  const existing = db.select().from(roleRoute).where(eq(roleRoute.role, input.role)).get()
  if (existing) {
    const row = db.update(roleRoute).set(values).where(eq(roleRoute.id, existing.id)).returning().get()
    return toDto(row)
  }
  return toDto(db.insert(roleRoute).values(values).returning().get())
}

export function deleteRoute(role: LlmRoleName): void {
  getDb().delete(roleRoute).where(eq(roleRoute.role, role)).run()
}

/** 某角色最终要调用的目标（含密钥），用于 fallback 依次尝试 */
export interface ResolvedTarget {
  providerId: number
  providerName: string
  kind: string
  baseUrl: string
  apiKey: string
  headers: Record<string, string>
  rateLimitPerMin: number
  model: string
  maxConcurrency: number
}

function toTarget(source: { dto: Provider; apiKey: string }, model: string, maxConcurrency: number): ResolvedTarget {
  return {
    providerId: source.dto.id,
    providerName: source.dto.name,
    kind: source.dto.kind,
    baseUrl: source.dto.baseUrl,
    apiKey: source.apiKey,
    headers: source.dto.headers,
    rateLimitPerMin: source.dto.rateLimitPerMin,
    model,
    maxConcurrency
  }
}

/**
 * 解析角色对应的调用目标链：路由主端点 → 备用端点；
 * 未配置路由时回退到第一个启用的端点。已停用的端点会被跳过。
 */
export function resolveTargets(role: LlmRoleName): ResolvedTarget[] {
  const route = getDb().select().from(roleRoute).where(eq(roleRoute.role, role)).get()
  const targets: ResolvedTarget[] = []

  if (route) {
    const primary = getProviderById(route.providerId)
    if (primary?.dto.enabled) targets.push(toTarget(primary, route.model || primary.dto.model, route.maxConcurrency))

    for (const id of route.fallbackChain ?? []) {
      const alternative = getProviderById(id)
      if (alternative?.dto.enabled) targets.push(toTarget(alternative, alternative.dto.model, 2))
    }
  }

  if (targets.length === 0) {
    const active = getActiveProvider()
    if (active) targets.push(toTarget(active, active.dto.model, 2))
  }

  return targets
}