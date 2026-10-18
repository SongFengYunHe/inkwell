import type { ReactNode } from 'react'
import { cn } from './cn'

/** 统一加载指示器（尺寸走 size，不再各页自画） */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-3.5 w-3.5 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** 区块级加载态：骨架不可用时用文案 + 转圈，四态之一 */
export function Loading({ label = '加载中…', className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn('flex items-center justify-center gap-2 py-8 text-xs text-ink-muted', className)}
      role="status"
      aria-live="polite"
    >
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

/** 空态：统一「还没有内容」的呈现与引导 */
export function EmptyState({
  title,
  description,
  action,
  className
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-10 text-center', className)}>
      <p className="text-sm text-ink-muted">{title}</p>
      {description && <p className="max-w-md text-xs text-ink-subtle">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** 错误态：把失败明确落到界面上（杜绝「失败仍报成功」） */
export function ErrorState({
  title = '出错了',
  message,
  action,
  className
}: {
  title?: string
  message?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2 py-10 text-center', className)}
      role="alert"
    >
      <p className="text-sm text-ink-danger">{title}</p>
      {message && <p className="max-w-md text-xs text-ink-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning'

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-ink-surface-2 text-ink-muted border-ink-border',
  primary: 'bg-amber-50 text-amber-700 border-amber-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200'
}

/** 统一徽标：状态 / 计数 / 标签 */
export function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-4',
        BADGE_TONE[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
