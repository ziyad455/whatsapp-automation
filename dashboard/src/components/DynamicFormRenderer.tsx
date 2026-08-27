import type { BusinessFieldDefinition, FieldIssue } from '../api/types'

export interface DynamicFormRendererProps {
  fields: BusinessFieldDefinition[]
  data: Record<string, unknown>
  onChange: (data: Record<string, unknown>) => void
  errors?: FieldIssue[]
}

interface FieldOption {
  value: string
  label: string
}

const parseOptions = (options: unknown): FieldOption[] => {
  if (!Array.isArray(options)) return []
  return options.flatMap((option) => {
    if (typeof option === 'string') return [{ value: option, label: option }]
    if (
      typeof option === 'object' &&
      option !== null &&
      'value' in option &&
      typeof option.value === 'string'
    ) {
      return [
        {
          value: option.value,
          label: 'label' in option && typeof option.label === 'string' ? option.label : option.value,
        },
      ]
    }
    return []
  })
}

const formatDateTimeInput = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function DynamicFormRenderer({ fields, data, onChange, errors = [] }: DynamicFormRendererProps) {
  const enabledFields = fields.filter((field) => field.enabled).sort((a, b) => a.displayOrder - b.displayOrder)

  function setValue(field: BusinessFieldDefinition, value: unknown) {
    const next = { ...data }
    const mayBeOmitted = !field.required && (value === '' || value === null || value === undefined)

    if (mayBeOmitted) delete next[field.key]
    else next[field.key] = value
    onChange(next)
  }

  return (
    <div className="dynamic-form">
      {enabledFields.map((field) => {
        const fieldErrors = errors.filter((error) => error.field === field.key)
        const errorId = fieldErrors.length ? `field-${field.id}-error` : undefined
        const common = {
          'aria-describedby': errorId,
          'aria-invalid': fieldErrors.length > 0,
          id: `field-${field.id}`,
          name: `data.${field.key}`,
        } as const
        const options = parseOptions(field.options)
        const fieldValue = data[field.key]

        return (
          <div className={`field${field.type === 'LONG_TEXT' ? ' field--wide' : ''}`} key={field.id}>
            <label htmlFor={common.id}>
              {field.label}{field.required ? <span className="required-mark" aria-hidden="true"> *</span> : null}
            </label>
            {field.type === 'LONG_TEXT' ? (
              <textarea {...common} required={field.required} rows={4} value={typeof fieldValue === 'string' ? fieldValue : ''} onChange={(event) => setValue(field, event.target.value)} />
            ) : null}
            {field.type === 'TEXT' ? (
              <input {...common} required={field.required} type="text" value={typeof fieldValue === 'string' ? fieldValue : ''} onChange={(event) => setValue(field, event.target.value)} />
            ) : null}
            {field.type === 'NUMBER' ? (
              <input {...common} required={field.required} type="number" value={typeof fieldValue === 'number' ? String(fieldValue) : ''} onChange={(event) => setValue(field, event.target.value === '' ? '' : Number(event.target.value))} />
            ) : null}
            {field.type === 'BOOLEAN' ? (
              <label className="checkbox-field" htmlFor={common.id}>
                <input {...common} checked={fieldValue === true} type="checkbox" onChange={(event) => setValue(field, event.target.checked)} />
                <span>{fieldValue === true ? 'Yes' : 'No'}</span>
              </label>
            ) : null}
            {field.type === 'DATE' ? (
              <input {...common} required={field.required} type="date" value={typeof fieldValue === 'string' ? fieldValue : ''} onChange={(event) => setValue(field, event.target.value)} />
            ) : null}
            {field.type === 'DATETIME' ? (
              <input {...common} required={field.required} type="datetime-local" value={formatDateTimeInput(fieldValue)} onChange={(event) => setValue(field, event.target.value ? new Date(event.target.value).toISOString() : '')} />
            ) : null}
            {field.type === 'SELECT' ? (
              <select {...common} required={field.required} value={typeof fieldValue === 'string' ? fieldValue : ''} onChange={(event) => setValue(field, event.target.value)}>
                <option value="">Select an option</option>
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : null}
            {field.type === 'MULTI_SELECT' ? (
              <select {...common} multiple required={field.required} size={Math.min(Math.max(options.length, 3), 6)} value={Array.isArray(fieldValue) ? fieldValue as string[] : []} onChange={(event) => setValue(field, Array.from(event.target.selectedOptions, (option) => option.value))}>
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : null}
            {fieldErrors.length ? <small className="field-error" id={errorId}>{fieldErrors.map((error) => error.message).join(' ')}</small> : null}
          </div>
        )
      })}
    </div>
  )
}
