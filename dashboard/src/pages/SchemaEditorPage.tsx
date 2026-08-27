import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { BusinessEntityType, BusinessFieldDefinition, BusinessFieldType } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const fieldTypes: BusinessFieldType[] = ['TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'SELECT', 'MULTI_SELECT']

export function SchemaEditorPage() {
  const { selectedBusiness } = useBusiness()
  const { entityTypeKey = '' } = useParams()
  const [entityType, setEntityType] = useState<BusinessEntityType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const load = useCallback(async () => {
    if (!selectedBusiness) return
    try {
      const response = await dashboardApi.getEntityType(selectedBusiness.id, entityTypeKey)
      setEntityType(response.entityType)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    }
  }, [entityTypeKey, selectedBusiness])

  useEffect(() => {
    if (!selectedBusiness) return
    let isCurrent = true

    dashboardApi
      .getEntityType(selectedBusiness.id, entityTypeKey)
      .then((response) => {
        if (isCurrent) setEntityType(response.entityType)
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(getErrorMessage(loadError))
      })

    return () => {
      isCurrent = false
    }
  }, [entityTypeKey, selectedBusiness])

  async function addField(input: Omit<BusinessFieldDefinition, 'id'>) {
    if (!selectedBusiness) return
    setError(null)
    setSuccess(null)
    try {
      await dashboardApi.addField(selectedBusiness.id, entityTypeKey, input)
      await load()
      setSuccess('Field added. Schema version increased.')
      setIsAdding(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    }
  }

  async function updateField(fieldId: string, input: Partial<Omit<BusinessFieldDefinition, 'id' | 'key'>>) {
    if (!selectedBusiness) return
    setError(null)
    setSuccess(null)
    try {
      await dashboardApi.updateField(selectedBusiness.id, entityTypeKey, fieldId, input)
      await load()
      setSuccess('Field updated. Schema version increased.')
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    }
  }

  if (!entityType && !error) return <LoadingBlock label="Loading schema…" />

  return (
    <div className="page-stack">
      {entityType ? (
        <PageHeader
          eyebrow={`Schema version ${entityType.schemaVersion}`}
          title={`${entityType.name} schema`}
          description="Field keys are permanent. Safe edits affect every future form for this business only."
          action={<button onClick={() => setIsAdding((value) => !value)} type="button">{isAdding ? 'Close form' : 'Add field'}</button>}
        />
      ) : null}
      <div><Link className="text-link" to={`/dashboard/data/${entityTypeKey}`}>← Back to records</Link></div>
      {isAdding && entityType ? <NewFieldForm nextOrder={entityType.fieldDefinitions?.length ?? 0} onSubmit={addField} /> : null}
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {success ? <StatusMessage tone="success">{success}</StatusMessage> : null}
      {entityType?.fieldDefinitions?.length ? (
        <div className="schema-list">
          {entityType.fieldDefinitions.map((field) => <FieldEditor field={field} key={field.id} onSave={updateField} />)}
        </div>
      ) : entityType ? (
        <p className="empty-list">No fields yet. Add the first field to generate a record form.</p>
      ) : null}
    </div>
  )
}

function NewFieldForm({ nextOrder, onSubmit }: { nextOrder: number; onSubmit: (input: Omit<BusinessFieldDefinition, 'id'>) => Promise<void> }) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<BusinessFieldType>('TEXT')
  const [required, setRequired] = useState(false)
  const [options, setOptions] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const selectable = type === 'SELECT' || type === 'MULTI_SELECT'
    void onSubmit({
      key,
      label,
      type,
      required,
      enabled: true,
      options: selectable ? options.split(',').map((option) => option.trim()).filter(Boolean) : null,
      displayOrder: nextOrder,
    })
  }

  return (
    <form className="inline-editor" onSubmit={submit}>
      <h2>New field</h2>
      <div className="form-grid form-grid--compact">
        <label className="field"><span>Key</span><input pattern="[a-z][a-z0-9_]*" required value={key} onChange={(event) => setKey(event.target.value.toLowerCase().replace(/\s+/g, '_'))} /></label>
        <label className="field"><span>Label</span><input required value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <label className="field"><span>Type</span><select value={type} onChange={(event) => setType(event.target.value as BusinessFieldType)}>{fieldTypes.map((fieldType) => <option key={fieldType} value={fieldType}>{formatFieldType(fieldType)}</option>)}</select></label>
        <label className="checkbox-field checkbox-field--standalone"><input checked={required} onChange={(event) => setRequired(event.target.checked)} type="checkbox" /><span>Required</span></label>
        {type === 'SELECT' || type === 'MULTI_SELECT' ? <label className="field field--wide"><span>Options</span><input required value={options} onChange={(event) => setOptions(event.target.value)} /><small>Comma-separated stored values.</small></label> : null}
      </div>
      <button type="submit">Add field</button>
    </form>
  )
}

function FieldEditor({ field, onSave }: { field: BusinessFieldDefinition; onSave: (fieldId: string, input: Partial<Omit<BusinessFieldDefinition, 'id' | 'key'>>) => Promise<void> }) {
  const [label, setLabel] = useState(field.label)
  const [type, setType] = useState(field.type)
  const [required, setRequired] = useState(field.required)
  const [enabled, setEnabled] = useState(field.enabled)
  const [displayOrder, setDisplayOrder] = useState(field.displayOrder)
  const [options, setOptions] = useState(optionsToText(field.options))
  const [isSaving, setIsSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    const selectable = type === 'SELECT' || type === 'MULTI_SELECT'
    await onSave(field.id, {
      label,
      type,
      required,
      enabled,
      displayOrder,
      options: selectable ? options.split(',').map((option) => option.trim()).filter(Boolean) : null,
    })
    setIsSaving(false)
  }

  return (
    <form className={`schema-row${enabled ? '' : ' schema-row--disabled'}`} onSubmit={submit}>
      <div className="schema-row__key"><strong>{field.key}</strong><span>Permanent key</span></div>
      <div className="schema-row__fields">
        <label className="field"><span>Label</span><input required value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <label className="field"><span>Type</span><select value={type} onChange={(event) => setType(event.target.value as BusinessFieldType)}>{fieldTypes.map((fieldType) => <option key={fieldType} value={fieldType}>{formatFieldType(fieldType)}</option>)}</select></label>
        <label className="field"><span>Order</span><input min={0} type="number" value={displayOrder} onChange={(event) => setDisplayOrder(Number(event.target.value))} /></label>
        {type === 'SELECT' || type === 'MULTI_SELECT' ? <label className="field field--wide"><span>Options</span><input value={options} onChange={(event) => setOptions(event.target.value)} /></label> : null}
        <div className="schema-row__toggles">
          <label className="checkbox-field"><input checked={required} onChange={(event) => setRequired(event.target.checked)} type="checkbox" /><span>Required</span></label>
          <label className="checkbox-field"><input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /><span>Enabled</span></label>
        </div>
      </div>
      <button className="secondary-button" disabled={isSaving} type="submit">{isSaving ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

function optionsToText(options: unknown): string {
  if (!Array.isArray(options)) return ''
  return options.map((option) => typeof option === 'string' ? option : typeof option === 'object' && option && 'value' in option ? String(option.value) : '').filter(Boolean).join(', ')
}

function formatFieldType(type: BusinessFieldType): string {
  return type.toLowerCase().split('_').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
}
