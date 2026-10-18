import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 必填：图标按钮必须有可读名称（无障碍） */
  label: string
  active?: boolean
}

export function IconButton({ label, active = false, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        'transition-ink inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm',
        'focus-visible:ring-2 focus-visible:ring-ink-primary/60 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-ink-surface-2 text-ink-text' : 'text-ink-muted hover:bg-ink-surface-2',
        className
      )}
      {...rest}
    />
  )
}
