import type { BusinessFieldDefinition, FieldIssue } from '../api/types'

export function validateDynamicForm(
  fields: BusinessFieldDefinition[],
  data: Record<string, unknown>,
): FieldIssue[] {
  const issues: FieldIssue[] = []

  for (const field of fields.filter((item) => item.enabled)) {
    const value = data[field.key]
    const isEmpty = value === undefined || value === null || value === ''

    if (field.required && isEmpty) {
      issues.push({
        field: field.key,
        code: 'MISSING_REQUIRED_FIELD',
        message: 'This field is required.',
      })
      continue
    }

    if (isEmpty) continue
    if (field.type === 'NUMBER' && (typeof value !== 'number' || !Number.isFinite(value))) {
      issues.push({ field: field.key, code: 'INVALID_TYPE', message: 'Enter a valid number.' })
    }
    if (field.type === 'MULTI_SELECT' && !Array.isArray(value)) {
      issues.push({
        field: field.key,
        code: 'INVALID_TYPE',
        message: 'Choose one or more valid options.',
      })
    }
  }

  return issues
}
