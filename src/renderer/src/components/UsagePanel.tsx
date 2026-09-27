import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-stone-800">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-stone-400">{hint}</p>}
    </div>
  )
}

export default function UsagePanel() {
  const usage = useAppStore((s) => s.usage)
  const loadUsage = useAppStore((s) => s.loadUsage)

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  if (!usage) {
    return <p className="text-sm text-stone-400">加载用量数据…</p>
  }

  const totalTokens = usage.promptTokens + usage.completionTokens
  const avgMs = usage.totalCalls > 0 ? Math.round(usage.totalDurationMs / usage.totalCalls) : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="总调用次数" value={usage.totalCalls} hint={usage.failedCalls > 0 ? `失败 ${usage.failedCalls} 次` : '无失败'} />
        <StatCard label="总 Token" value={totalTokens.toLocaleString()} hint={`输入 ${usage.promptTokens.toLocaleString()} / 输出 ${usage.completionTokens.toLocaleString()}`} />
        <StatCard label="平均耗时" value={`${avgMs} ms`} hint={usage.totalCalls > 0 ? `合计 ${(usage.totalDurationMs / 1000).toFixed(1)} s` : '—'} />
        <StatCard label="按角色统计" value={usage.byRole.length} hint="已产生调用的角色数" />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-medium text-stone-700">按角色</h2>
        {usage.byRole.length === 0 ? (
          <p className="mt-2 text-xs text-stone-400">还没有调用记录</p>
        ) : (
          <div className="mt-2 space-y-1">
            {usage.byRole.map((row) => (
              <div key={row.role} className="flex items-center gap-3 text-xs text-stone-600">
                <span className="w-24 shrink-0 font-medium text-stone-700">{row.role}</span>
                <span className="w-20 shrink-0">{row.calls} 次</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{ width: `${Math.min(100, Math.round((row.tokens / Math.max(1, totalTokens)) * 100))}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-stone-400">{row.tokens.toLocaleString()} token</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-medium text-stone-700">最近调用</h2>
        {usage.recent.length === 0 ? (
          <p className="mt-2 text-xs text-stone-400">还没有调用记录</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-600">
              <thead>
                <tr className="text-stone-400">
                  <th className="py-1.5 pr-3 font-normal">时间</th>
                  <th className="py-1.5 pr-3 font-normal">角色</th>
                  <th className="py-1.5 pr-3 font-normal">端点</th>
                  <th className="py-1.5 pr-3 font-normal">模型</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Token</th>
                  <th className="py-1.5 pr-3 text-right font-normal">耗时</th>
                  <th className="py-1.5 font-normal">状态</th>
                </tr>
              </thead>
              <tbody>
                {usage.recent.map((row) => (
                  <tr key={row.id} className="border-t border-stone-100">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-stone-400">{formatTime(row.createdAt)}</td>
                    <td className="py-1.5 pr-3">{row.role}</td>
                    <td className="py-1.5 pr-3">{row.providerName}</td>
                    <td className="max-w-[160px] truncate py-1.5 pr-3" title={row.model}>
                      {row.model}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {row.promptTokens + row.completionTokens}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{row.durationMs} ms</td>
                    <td className={`py-1.5 ${row.success ? 'text-emerald-600' : 'text-red-600'}`}>
                      {row.success ? '成功' : `失败：${row.error.slice(0, 40)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}