import type { LlmRoleName } from '@shared/types'
import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS } from './ui'

const ROLES: Array<{ key: LlmRoleName; label: string; hint: string }> = [
  { key: 'architect', label: '架构', hint: '总大纲 / 逐章细纲 / 新建向导' },
  { key: 'writer', label: '写作', hint: '章节正文 / 续写 / 重写 / 润色' },
  { key: 'reviewer', label: '审稿', hint: '一致性审计（M3 起启用）' },
  { key: 'extractor', label: '抽取', hint: '摘要 / 状态抽取（M3 起启用）' },
  { key: 'embedder', label: '向量', hint: 'RAG 检索（M3 起启用）' }
]

function RouteEditor({ role, label, hint }: { role: LlmRoleName; label: string; hint: string }) {
  const providers = useAppStore((s) => s.providers)
  const routes = useAppStore((s) => s.routes)
  const loading = useAppStore((s) => s.loading)
  const saveRoute = useAppStore((s) => s.saveRoute)
  const removeRoute = useAppStore((s) => s.removeRoute)

  const route = routes.find((item) => item.role === role) ?? null
  const enabledProviders = providers.filter((item) => item.enabled)
  const fallbackCandidates = enabledProviders.filter((item) => item.id !== (route?.providerId ?? -1))

  const [providerId, setProviderId] = useState(route?.providerId ?? enabledProviders[0]?.id ?? 0)
  const [model, setModel] = useState(route?.model ?? '')
  const [maxConcurrency, setMaxConcurrency] = useState(route?.maxConcurrency ?? 2)
  const [fallback, setFallback] = useState<number[]>(route?.fallbackChain ?? [])

  useEffect(() => {
    setProviderId(route?.providerId ?? enabledProviders[0]?.id ?? 0)
    setModel(route?.model ?? '')
    setMaxConcurrency(route?.maxConcurrency ?? 2)
    setFallback(route?.fallbackChain ?? [])
  }, [route?.id, route?.updatedAt, providers.length])

  const toggleFallback = (id: number): void => {
    setFallback((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id].slice(0, 5)))
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-stone-800">{label}</span>
          <span className="ml-2 text-xs text-stone-400">{hint}</span>
        </div>
        <span
          className={`ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] ${
            route ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'
          }`}
        >
          {route ? '已配置' : '未配置 · 用默认端点'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_120px]">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-stone-500">端点</span>
          <select
            value={providerId}
            onChange={(e) => setProviderId(Number(e.target.value))}
            className={INPUT_CLASS}
          >
            {enabledProviders.length === 0 && <option value={0}>（没有启用的端点）</option>}
            {enabledProviders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.model}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-stone-500">模型（留空沿用端点默认）</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} className={INPUT_CLASS} placeholder="例如 deepseek-chat" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-stone-500">并发上限</span>
          <input
            type="number"
            min={1}
            max={8}
            value={maxConcurrency}
            onChange={(e) => setMaxConcurrency(Number(e.target.value) || 1)}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      {fallbackCandidates.length > 0 && (
        <div className="mt-3">
          <span className="text-xs text-stone-500">失败时依次回退到（fallback 链）</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {fallbackCandidates.map((item) => (
              <label
                key={item.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  fallback.includes(item.id)
                    ? 'border-amber-400 bg-amber-50 text-amber-800'
                    : 'border-stone-200 text-stone-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={fallback.includes(item.id)}
                  onChange={() => toggleFallback(item.id)}
                  className="h-3.5 w-3.5 rounded border-stone-300"
                />
                {item.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={loading || providerId === 0}
          onClick={() =>
            void saveRoute({ role, providerId, model, fallbackChain: fallback, maxConcurrency })
          }
          className={BUTTON_PRIMARY}
        >
          保存路由
        </button>
        {route && (
          <button type="button" onClick={() => void removeRoute(role)} className={BUTTON_GHOST}>
            清除（回到默认）
          </button>
        )}
      </div>
    </div>
  )
}

export default function RoutePanel() {
  const loadRoutes = useAppStore((s) => s.loadRoutes)

  useEffect(() => {
    void loadRoutes()
  }, [loadRoutes])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-stone-500">
        把「创作角色」映射到「端点 + 模型」。未配置时全部走第一个启用的端点；配置后可按角色分级用模型（例如架构用强模型、写作用性价比模型）。
      </p>
      {ROLES.map((item) => (
        <RouteEditor key={item.key} role={item.key} label={item.label} hint={item.hint} />
      ))}
    </div>
  )
}