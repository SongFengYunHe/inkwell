import type {
  BriefFieldKey,
  ParsedTree,
  ValidationFieldResult,
  ValidationReport,
  ValidationRow
} from '@shared/types'
import { DEFAULT_REQUIRED_FIELDS, FIELD_LABELS } from './patterns'

/**
 * 导入体检表（计划书 §4.4）：警告级，不阻断导入。
 */

/** 展示顺序 */
const FIELD_ORDER: BriefFieldKey[] = [
  'purpose',
  'keyEvents',
  'characters',
  'suspenseHook',
  'sceneBeats',
  'userGuidance',
  'notes'
]

export function validateTree(
  tree: ParsedTree,
  requiredFields: BriefFieldKey[] = DEFAULT_REQUIRED_FIELDS
): ValidationReport {
  const requiredSet = new Set(requiredFields)
  const rows: ValidationRow[] = []

  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      const fields: ValidationFieldResult[] = FIELD_ORDER.map((field) => ({
        field,
        label: FIELD_LABELS[field],
        present: chapter.fields[field].value.trim().length > 0,
        required: requiredSet.has(field)
      }))
      const missing = fields.filter((item) => item.required && !item.present).map((item) => `${item.label}：未识别`)
      rows.push({
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        fields,
        missingRequired: missing.length,
        missing
      })
    }
  }

  const totalMissing = rows.reduce((sum, row) => sum + row.missingRequired, 0)
  const totalRequired = rows.length * requiredFields.length
  const passRate = totalRequired === 0 ? 100 : Math.round(((totalRequired - totalMissing) / totalRequired) * 100)

  return { rows, requiredFields, totalMissing, passRate }
}

/** 导出体检报告为 Markdown（计划书 §4.4「导出体检报告为 Markdown」） */
export function exportValidationMarkdown(report: ValidationReport, title = '导入体检报告'): string {
  const header = ['章节', '标题', ...FIELD_ORDER.map((field) => FIELD_LABELS[field]), '合计']
  const lines: string[] = [`# ${title}`, '', `- 章节数：${report.rows.length}`, `- 缺项合计：${report.totalMissing}`, `- 必填项通过率：${report.passRate}%`, '']
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)

  for (const row of report.rows) {
    const cells = [String(row.chapterNo), row.title || '（未命名）']
    for (const field of FIELD_ORDER) {
      const result = row.fields.find((item) => item.field === field)
      cells.push(result?.present ? '✅' : '⚠️')
    }
    cells.push(String(row.missingRequired))
    lines.push(`| ${cells.join(' | ')} |`)
  }

  const missingRows = report.rows.filter((row) => row.missing.length > 0)
  lines.push('', '## 缺项明细')
  if (missingRows.length === 0) {
    lines.push('全部必填项均已识别。')
  } else {
    for (const row of missingRows) {
      for (const item of row.missing) lines.push(`- 第${row.chapterNo}章 · ${item}`)
    }
  }
  return lines.join('\n')
}