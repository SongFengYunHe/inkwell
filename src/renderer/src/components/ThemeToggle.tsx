import { useAppStore } from '../stores/appStore'

/** 深浅主题切换（M5）：选择写入 localStorage，下次启动沿用 */
export default function ThemeToggle() {
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const dark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={dark ? '切换到浅色主题' : '切换到深色主题'}
      aria-label={dark ? '切换到浅色主题' : '切换到深色主题'}
      className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
    >
      <span className="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
          {dark ? (
            <path
              strokeLinecap="round"
              d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
            />
          ) : (
            <path strokeLinecap="round" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
          )}
        </svg>
        {dark ? '浅色' : '深色'}
      </span>
    </button>
  )
}