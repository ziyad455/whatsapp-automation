import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { BusinessEntityType } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

export function EntityTypesPage() {
  const { selectedBusiness } = useBusiness()
  const [entityTypes, setEntityTypes] = useState<BusinessEntityType[] | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!selectedBusiness) return
    dashboardApi
      .listEntityTypes(selectedBusiness.id)
      .then((response) => setEntityTypes(response.entityTypes))
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
  }, [selectedBusiness])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBusiness) return
    setError(null)
    setIsSaving(true)

    try {
      const response = await dashboardApi.createEntityType(selectedBusiness.id, {
        name,
        key,
        description: description || null,
      })
      setEntityTypes((current) => [...(current ?? []), { ...response.entityType, fieldCount: 0 }])
      setName('')
      setKey('')
      setDescription('')
      setIsAdding(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  if (!entityTypes && !error) return <LoadingBlock label="Loading business data…" />

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Dynamic data"
        title="Business data"
        description="Define the kinds of records this business manages. Every type uses the same generic schema and form system."
        action={<button onClick={() => setIsAdding((value) => !value)} type="button">{isAdding ? 'Close form' : 'Add data type'}</button>}
      />
      {isAdding ? (
        <form className="inline-editor" onSubmit={handleSubmit}>
          <h2>New data type</h2>
          <div className="form-grid">
            <label className="field"><span>Name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field"><span>Key</span><input pattern="[a-z][a-z0-9_]*" required value={key} onChange={(event) => setKey(event.target.value.toLowerCase().replace(/\s+/g, '_'))} /><small>Permanent lowercase identifier, for example product.</small></label>
            <label className="field field--wide"><span>Description</span><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          </div>
          <button disabled={isSaving} type="submit">{isSaving ? 'Creating…' : 'Create data type'}</button>
        </form>
      ) : null}
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {entityTypes?.length ? (
        <div className="record-list">
          {entityTypes.map((entityType) => (
            <article className="record-row" key={entityType.id}>
              <div className="record-row__main">
                <div className="record-row__meta"><span>{entityType.key}</span><span>Schema v{entityType.schemaVersion}</span><span>{entityType.fieldCount ?? entityType.fieldDefinitions?.length ?? 0} fields</span></div>
                <h2>{entityType.name}</h2>
                <p>{entityType.description || 'No description added.'}</p>
              </div>
              <div className="record-row__actions">
                <Link className="secondary-link" to={`/dashboard/data/${entityType.key}`}>View records</Link>
                <Link className="text-link" to={`/dashboard/schema/${entityType.key}`}>Edit schema</Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-list">No data types exist yet. Add one to start defining business records.</p>
      )}
    </div>
  )
}
