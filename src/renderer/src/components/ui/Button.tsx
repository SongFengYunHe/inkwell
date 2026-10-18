import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'
import { Spinner } from './States'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

/*
 * 四级按钮（主/次/危险/幽灵）唯一实现。
 * 历史缺陷的根因之一就是各页各自写按钮样式，同一动作长相/行为不一致。
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border border-transparent bg-stone-900 text-white hover:bg-stone-700',
  secondary: 'border border-ink-border bg-ink-surface text-ink-muted hover:bg-ink-surface-2',
  danger: 'border border-transparent bg-red-600 text-white hover:bg-red-500',
  ghost: 'border border-transparent text-ink-muted hover:bg-ink-surface-2'
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-xs',
  md: 'gap-2 px-4 py-2 text-sm'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'transition-ink inline-flex items-center justify-center rounded-lg font-medium',
        'focus-visible:ring-2 focus-visible:ring-ink-primary/60 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}
