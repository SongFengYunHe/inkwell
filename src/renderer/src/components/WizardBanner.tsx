import { useAppStore } from '../stores/appStore'

/** 新建向导的进度 / 结果条：运行中显示进度与停止按钮，结束后显示一次性结果提示 */
export default function WizardBanner() {
  const wizard = useAppStore((s) => s.wizard)
  const wizardNotice = useAppStore((s) => s.wizardNotice)
  const abortWizard = useAppStore((s) => s.abortWizard)
  const clearWizardNotice = useAppStore((s) => s.clearWizardNotice)

  if (!wizard && !wizardNotice) return null

  if (wizard) {
    const progress = wizard.progress
    const percent = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0

    return (
      <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5">
        <div className="flex items-center gap-3 text-sm text-amber-900">
          <span className="font-medium">AI 生成中</span>
          <span className="truncate">{progress?.message ?? '正在准备…'}</span>
          <button
            type="button"
            onClick={() => void abortWizard()}
            className="ml-auto shrink-0 rounded border border-amber-300 px-2 py-0.5 text-xs transition hover:bg-amber-100"
          >
            停止
          </button>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-amber-100">
          <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 border-b border-stone-200 bg-emerald-50 px-5 py-2 text-sm text-emerald-800">
      <span className="truncate">{wizardNotice}</span>
      <button
        type="button"
        onClick={clearWizardNotice}
        className="ml-auto shrink-0 text-xs text-emerald-700/70 hover:text-emerald-900"
      >
        关闭
      </button>
    </div>
  )
}