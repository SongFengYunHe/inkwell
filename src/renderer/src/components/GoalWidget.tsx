import { useAppStore } from '../stores/appStore'

/**
 * 写作目标进度环（M8 §5.3）。
 * 数据来自 writing_stat 的「今日字数」与 writing_goal 的每日目标（全局，按库计）。
 */
export default function GoalWidget({ size = 52 }: { size?: number }) {
  const stat = useAppStore((s) => s.stat)
  const words = stat?.today.wordsAdded ?? 0
  const goal = stat?.goal.dailyWords ?? 3000
  const ratio = goal > 0 ? Math.min(1, Math.max(0, words / goal)) : 0

  const stroke = 5
  const radius = size / 2 - stroke / 2 - 1
  const circumference = 2 * Math.PI * radius
  const dash = circumference * ratio

  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-stone-200"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="text-amber-500"
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-stone-600 text-[10px] font-medium"
        >
          {Math.round(ratio * 100)}%
        </text>
      </svg>
      <div className="leading-tight">
        <div className="text-xs text-stone-500">今日进度</div>
        <div className="text-xs font-medium text-stone-700">
          {words.toLocaleString()} / {goal.toLocaleString()} 字
        </div>
      </div>
    </div>
  )
}