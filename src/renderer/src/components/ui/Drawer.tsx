import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from './cn'
import { IconButton } from './IconButton'

/**
 * 统一侧边抽屉（M13-A）。Dock 面板的「折叠为窄条 / 展开」也复用同一交互语言。
 */
export function Drawer({
  title,
  open = true,
  side = 'right',
  width = 360,
  onClose,
  children,
  footer,
  className
}: {
  title?: ReactNode
  open?: boolean
  side?: 'left' | 'right'
  width?: number
  onClose?: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open || !onClose) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  const isOverlay = Boolean(onClose)

  return (
    <>
      {isOverlay && (
        <div
          className="animate-fade fixed inset-0 z-40 bg-stone-900/30"
          onMouseDown={() => closeRef.current?.()}
          aria-hidden="true"
        />
      )}
      <aside
        role="complementary"
        style={{ width }}
        className={cn(
          'animate-fade-in flex min-h-0 flex-col border-ink-border bg-ink-surface',
          isOverlay ? 'fixed inset-y-0 z-40 border-l shadow-overlay' : 'border-l',
          side === 'right' ? 'right-0' : 'left-0',
          className
        )}
      >
        {(title || onClose) && (
          <header className="flex items-center gap-3 border-b border-ink-border px-4 py-3">
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink-text">{title}</div>
            {onClose && <IconButton label="关闭" onClick={() => closeRef.current?.()} />}
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <footer className="border-t border-ink-border px-4 py-3">{footer}</footer>}
      </aside>
    </>
  )
}
