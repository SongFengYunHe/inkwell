import type { AuditCheck } from '@shared/types'
import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { Badge, Button, EmptyState } from './ui'

const SEVERITY_STYLE: Record<AuditCheck['severity'], string> = {
  info: 'text-stone-400',
  warn: 'text-amber-600',
  error: 'text-red-600'
}

/**
 * M13-B 右侧 Dock 面板：本章一致性审计。
 * 与「记忆」Tab 里的审计 Section 同源（都读 store.audit），
 * 但 Dock 形态下只聚焦本章结论，便于与正文同屏对照修订。
 */
export default function ChapterAuditPanel() {
  const audit = useAppStore((s) => s.audit)
  const currentChapterNo = useAppStore((s) => s.currentChapterNo)
  const generating = useAppStore((s) => s.generating)
  const loading = useAppStore((s) => s.loading)
  const auditCurrent = useAppStore((s) => s.auditCurrent)
  const loadLatestAudit = useAppStore((s) => s.loadLatestAudit)

  useEffect(() => {
    void loadLatestAudit(currentChapterNo)
  }, [loadLatestAudit, currentChapterNo])

  const failed = audit ? audit.checks.filter((check) => !check.passed).length : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-2.5">
        <span className="text-xs font-medium text-stone-600">第 {currentChapterNo} 章 · 一致性审计</span>
        {audit && (
          <Badge tone={audit.passed ? 'success' : failed > 0 ? 'danger' : 'warning'}>
            {audit.passed ? '通过' : `${failed} 项未过`} · {audit.score}
          </Badge>
        )}
        <Button
          size="sm"
          className="ml-auto"
          loading={loading && generating === null}
          disabled={generating !== null}
          onClick={() => void auditCurrent()}
        >
          运行审计
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!audit ? (
          <EmptyState
            title="本章还没有审计报告"
            description="生成正文后会自动审计；也可点右上角「运行审计」立即检查与七个真相文件的一致性。"
          />
        ) : (
          <ul className="space-y-1.5 text-sm">
            <li className="text-xs text-stone-400">
              共 {audit.checks.length} 项
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
      </div>
    </div>
  )
}
