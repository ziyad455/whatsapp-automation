import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, dashboardApi, getErrorMessage } from '../api/client'
import type { BusinessEntityType, FieldIssue } from '../api/types'
import { useBusiness } from '../business/business-context'
import { DynamicFormRenderer } from '../components/DynamicFormRenderer'
import { validateDynamicForm } from '../components/dynamic-form-validation'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

export function EntityFormPage() {
  const navigate = useNavigate()
  const { selectedBusiness } = useBusiness()
  const { entityTypeKey = '', entityId } = useParams()
  const [entityType, setEntityType] = useState<BusinessEntityType | null>(null)
  const [name, setName] = useState('')
  const [data, setData] = useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = useState<FieldIssue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!selectedBusiness) return
    let isCurrent = true

    async function load() {
      try {
        const [typeResponse, entityResponse] = await Promise.all([
          dashboardApi.getEntityType(selectedBusiness!.id, entityTypeKey),
          entityId
            ? dashboardApi.getEntity(selectedBusiness!.id, entityTypeKey, entityId)
            : Promise.resolve(null),
        ])

        if (!isCurrent) return
        setEntityType(typeResponse.entityType)
        if (entityResponse) {
          setName(entityResponse.entity.name)
          setData(entityResponse.entity.data)
        }
      } catch (loadError) {
        if (isCurrent) setError(getErrorMessage(loadError))
      }
    }

    void load()
    return () => {
      isCurrent = false
    }
  }, [entityId, entityTypeKey, selectedBusiness])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBusiness || !entityType?.fieldDefinitions) return
    const clientIssues = validateDynamicForm(entityType.fieldDefinitions, data)
    if (!name.trim()) clientIssues.unshift({ field: 'name', code: 'MISSING_REQUIRED_FIELD', message: 'Name is required.' })
    setFieldErrors(clientIssues)
    setError(null)
    if (clientIssues.length) return
    setIsSaving(true)

    try {
      if (entityId) {
        await dashboardApi.updateEntity(selectedBusiness.id, entityTypeKey, entityId, { name, data })
      } else {
        await dashboardApi.createEntity(selectedBusiness.id, entityTypeKey, { name, data })
      }
      navigate(`/dashboard/data/${entityTypeKey}`, { replace: true })
    } catch (saveError) {
      if (saveError instanceof ApiError) setFieldErrors(saveError.fields)
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  if (!entityType && !error) return <LoadingBlock label="Loading form schema…" />

  return (
    <div className="page-stack">
      {entityType ? (
        <PageHeader
          eyebrow={entityId ? 'Edit record' : 'New record'}
          title={`${entityId ? 'Edit' : 'Add'} ${entityType.name.replace(/s$/, '')}`}
          description={`This form is generated from ${entityType.name}' current schema (v${entityType.schemaVersion}).`}
        />
      ) : null}
      {error && !entityType ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {entityType?.fieldDefinitions ? (
        <form className="settings-form entity-form" onSubmit={handleSubmit}>
          <section className="settings-section">
            <div className="settings-section__intro"><h2>Record details</h2><p>Required fields are marked with an asterisk.</p></div>
            <div className="dynamic-form">
              <div className="field field--wide">
                <label htmlFor="entity-name">Name<span className="required-mark" aria-hidden="true"> *</span></label>
                <input aria-invalid={fieldErrors.some((issue) => issue.field === 'name')} id="entity-name" required value={name} onChange={(event) => setName(event.target.value)} />
                {fieldErrors.filter((issue) => issue.field === 'name').map((issue) => <small className="field-error" key={issue.code}>{issue.message}</small>)}
              </div>
              <DynamicFormRenderer data={data} errors={fieldErrors} fields={entityType.fieldDefinitions} onChange={setData} />
            </div>
          </section>
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
          <div className="form-actions">
            <button disabled={isSaving} type="submit">{isSaving ? 'Saving…' : 'Save record'}</button>
            <Link className="text-link" to={`/dashboard/data/${entityTypeKey}`}>Cancel</Link>
          </div>
        </form>
      ) : null}
    </div>
  )
}
