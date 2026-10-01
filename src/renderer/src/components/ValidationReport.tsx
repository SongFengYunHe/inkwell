import type { ValidationReport as ValidationReportData } from '@shared/types'

/** 导入体检表（警告级，不阻断导入）；支持导出 Markdown 报告 */
export default function ValidationReport({ report }: { report: ValidationReportData }) {
  const exportMarkdown = (): void => {
    const text = toMarkdown(report)
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = '导入体检报告.md'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">
          共 {report.rows.length} 章 · 缺项 {report.totalMissing} · 必填项通过率 {report.passRate}%
        </p>
        <button
          type="button"
          onClick={exportMarkdown}
          className="rounded-lg border border-stone-200 px-3 py-1 text-xs text-stone-600 transition hover:bg-stone-50"
        >
          导出 Markdown
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr className="bg-stone-50 text-stone-500">
              <th className="px-2 py-1.5 text-left">章节</th>
              <th className="px-2 py-1.5 text-left">标题</th>
              {report.rows[0]?.fields.map((field) => (
                <th key={field.field} className="px-2 py-1.5 text-center">
                  {field.label}
                </th>
              ))}
              <th className="px-2 py-1.5 text-center">合计</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.chapterNo} className="border-t border-stone-100">
                <td className="px-2 py-1.5 text-stone-500">第{row.chapterNo}章</td>
                <td className="max-w-[160px] truncate px-2 py-1.5 text-stone-700">{row.title || '（未命名）'}</td>
                {row.fields.map((field) => (
                  <td key={field.field} className="px-2 py-1.5 text-center">
                    {field.present ? '✅' : '⚠️'}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center text-stone-500">{row.missingRequired}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.rows.some((row) => row.missing.length > 0) && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="mb-1 font-medium">缺项明细（不阻断导入，落库后可在细纲页补）</p>
          <ul className="space-y-0.5">
            {report.rows.flatMap((row) =>
              row.missing.map((item) => (
                <li key={`${row.chapterNo}-${item}`}>
                  第{row.chapterNo}章 · {item}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function toMarkdown(report: ValidationReportData): string {
  const header = ['章节', '标题', ...(report.rows[0]?.fields.map((field) => field.label) ?? []), '合计']
  const lines: string[] = [
    '# 导入体检报告',
    '',
    `- 章节数：${report.rows.length}`,
    `- 缺项合计：${report.totalMissing}`,
    `- 必填项通过率：${report.passRate}%`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`
  ]
  for (const row of report.rows) {
    const cells = [String(row.chapterNo), row.title || '（未命名）']
    for (const field of row.fields) cells.push(field.present ? '✅' : '⚠️')
    cells.push(String(row.missingRequired))
    lines.push(`| ${cells.join(' | ')} |`)
  }
  lines.push('', '## 缺项明细')
  const missing = report.rows.filter((row) => row.missing.length > 0)
  if (missing.length === 0) lines.push('全部必填项均已识别。')
  else for (const row of missing) for (const item of row.missing) lines.push(`- 第${row.chapterNo}章 · ${item}`)
  return lines.join('\n')
}