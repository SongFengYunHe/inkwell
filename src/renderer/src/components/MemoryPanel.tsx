import type { AuditCheck } from '@shared/types'
import { useEffect, type ReactNode } from 'react'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST } from './ui'

const SEVERITY_STYLE: Record<AuditCheck['severity'], string> = {
  info: 'text-stone-400',
  warn: 'text-amber-600',
  error: 'text-red-600'
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <header className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-medium text-stone-800">{title}</h3>
        {hint && <span className="text-xs text-stone-400">{hint}</span>}
      </header>
      {children}
    </section>
  )
}

/** 记忆面板：七个真相文件 + 章节审计报告（计划书 §7.2 / §7.3） */
export default function MemoryPanel() {
  const truth = useAppStore((s) => s.truth)
  const audit = useAppStore((s) => s.audit)
  const currentChapterNo = useAppStore((s) => s.currentChapterNo)
  const loading = useAppStore((s) => s.loading)
  const loadTruthFiles = useAppStore((s) => s.loadTruthFiles)
  const loadLatestAudit = useAppStore((s) => s.loadLatestAudit)
  const rebuildMemory = useAppStore((s) => s.rebuildMemory)

  useEffect(() => {
    void loadTruthFiles()
    void loadLatestAudit(currentChapterNo)
  }, [loadTruthFiles, loadLatestAudit, currentChapterNo])

  if (!truth) {
    return <div className="text-sm text-stone-400">正在读取记忆…</div>
  }

  const progress = truth.chapterSummaries.length

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-stone-400">
          已沉淀 {progress} 章记忆 · 角色 {truth.characterMatrix.length} · 待处理线 {truth.pendingHooks.length}
        </span>
        <button type="button" disabled={loading} onClick={() => void rebuildMemory()} className={BUTTON_GHOST}>
          从正文重建记忆
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="① 世界当前状态" hint="world_state">
          {truth.worldState ? (
            <p className="whitespace-pre-wrap text-sm text-stone-700">{truth.worldState}</p>
          ) : (
            <p className="text-xs text-stone-400">尚未沉淀</p>
          )}
        </Section>

        <Section title="⑥ 时间线" hint="timeline">
          {truth.timeline ? (
            <p className="whitespace-pre-wrap text-sm text-stone-700">{truth.timeline}</p>
          ) : (
            <p className="text-xs text-stone-400">尚未沉淀</p>
          )}
        </Section>

        <Section title="⑦ 资源 / 道具账本" hint="resource_ledger">
          {truth.resourceLedger ? (
            <p className="whitespace-pre-wrap text-sm text-stone-700">{truth.resourceLedger}</p>
          ) : (
            <p className="text-xs text-stone-400">尚未沉淀</p>
          )}
        </Section>

        <Section title="③ 待处理伏笔池" hint="pending_hooks">
          {truth.pendingHooks.length === 0 ? (
            <p className="text-xs text-stone-400">暂无活跃伏笔</p>
          ) : (
            <ul className="space-y-1 text-sm text-stone-700">
              {truth.pendingHooks.map((thread) => (
                <li key={thread.id} className="flex items-center gap-2">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500">{thread.type}</span>
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                  <span className="text-xs text-stone-400">{thread.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="⑤ 支线进度板" hint="subplot_board">
          {truth.subplotBoard.length === 0 ? (
            <p className="text-xs text-stone-400">暂无支线</p>
          ) : (
            <ul className="space-y-1 text-sm text-stone-700">
              {truth.subplotBoard.map((thread) => (
                <li key={thread.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                  <span className="text-xs text-stone-400">{thread.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="② 角色矩阵与当前状态" hint="character_matrix">
        {truth.characterMatrix.length === 0 ? (
          <p className="text-xs text-stone-400">尚未沉淀角色状态，连写几章后会自动生成</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {truth.characterMatrix.map((card) => (
              <div key={card.id} className="rounded-lg border border-stone-100 bg-stone-50/60 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-stone-800">{card.name}</span>
                  <span className="text-[11px] text-stone-400">
                    {card.csUpdatedCh > 0 ? `更新于第 ${card.csUpdatedCh} 章` : '未更新'}
                  </span>
                </div>
                <dl className="mt-1 space-y-0.5 text-xs text-stone-600">
                  {card.csState && <div>状态：{card.csState}</div>}
                  {card.csLocation && <div>所在：{card.csLocation}</div>}
                  {card.csPower && <div>能力：{card.csPower}</div>}
                  {card.csItems.length > 0 && <div>持有：{card.csItems.join('、')}</div>}
                  {card.csRecent && <div className="text-stone-400">近况：{card.csRecent}</div>}
                </dl>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="④ 章节摘要链" hint="chapter_summaries">
        {truth.chapterSummaries.length === 0 ? (
          <p className="text-xs text-stone-400">尚未沉淀</p>
        ) : (
          <ol className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm text-stone-700">
            {truth.chapterSummaries.map((item) => (
              <li key={item.chapterNo} className="flex gap-2">
                <span className="shrink-0 text-xs text-stone-400">第 {item.chapterNo} 章</span>
                <span className="min-w-0 flex-1">{item.summary}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={`第 ${currentChapterNo} 章 · 一致性审计`} hint={audit ? `score ${audit.score}` : '暂无报告'}>
        {!audit ? (
          <p className="text-xs text-stone-400">本章还没有审计报告，生成后自动产生</p>
        ) : (
          <ul className="space-y-1 text-sm">
            <li className="text-xs text-stone-400">
              共 {audit.checks.length} 项 · {audit.passed ? '整体通过' : '存在 error 级问题'}
              {audit.modelAssisted ? ' · 含模型语义审计' : ''}
            </li>
            {audit.checks.map((check, index) => (
              <li key={`${check.dimension}-${index}`} className="flex items-start gap-2">
                <span className={check.passed ? 'text-emerald-500' : SEVERITY_STYLE[check.severity]}>
                  {check.passed ? '✓' : '✗'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-stone-700">{check.dimension}</span>
                  {check.paragraph !== undefined && (
                    <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500">
                      第 {check.paragraph + 1} 段
                    </span>
                  )}
                  <span className="ml-2 text-xs text-stone-400">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}