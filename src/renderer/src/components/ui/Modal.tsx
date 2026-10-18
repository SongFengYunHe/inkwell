import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from './cn'
import { IconButton } from './IconButton'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const SIZE: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'h-full w-full max-w-none rounded-none'
}

export interface ModalProps {
  title?: ReactNode
  description?: ReactNode
  size?: ModalSize
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** 允许 Esc / 点遮罩关闭（默认 true；危险流程可关掉） */
  dismissable?: boolean
  className?: string
}

/**
 * 统一弹层（M13-A）：Esc 关闭、点遮罩关闭、焦点进入并循环、关闭后焦点归位。
 * 所有自绘 `fixed inset-0` 弹窗都应改用它，避免同一动作在不同页面表现不一致。
 */
export function Modal({
  title,
  description,
  size = 'md',
  onClose,
  children,
  footer,
  dismissable = true,
  className
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(
      '[data-autofocus], input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (dismissable) closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      // 焦点循环：不允许 Tab 逃出弹层（键盘闭环）
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((node) => !node.hasAttribute('disabled'))
      if (focusables.length === 0) return
      const current = document.activeElement as HTMLElement | null
      const index = current ? focusables.indexOf(current) : -1
      const next = event.shiftKey ? (index <= 0 ? focusables.length - 1 : index - 1) : (index + 1) % focusables.length
      event.preventDefault()
      focusables[next]?.focus()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      restore?.focus?.()
    }
  }, [dismissable])

  const full = size === 'full'

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex bg-stone-900/40',
        full ? 'items-stretch justify-stretch' : 'items-center justify-center p-6'
      )}
      onMouseDown={(event) => {
        if (dismissable && event.target === event.currentTarget) closeRef.current()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'animate-fade-in flex min-h-0 flex-col overflow-hidden bg-ink-surface shadow-overlay',
          full ? '' : 'w-full rounded-panel',
          SIZE[size],
          className
        )}
      >
        {(title || dismissable) && (
          <header className="flex items-start gap-3 border-b border-ink-border px-5 py-3.5">
            <div className="min-w-0 flex-1">
              {title && <h2 className="truncate text-sm font-medium text-ink-text">{title}</h2>}
              {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
            </div>
            {dismissable && <IconButton label="关闭" onClick={() => closeRef.current()} className="-mr-1 shrink-0">✕</IconButton>}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-ink-border bg-ink-surface-2 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
