import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { BusinessEntity, BusinessEntityType } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

export function EntityListPage() {
  const { selectedBusiness } = useBusiness()
  const { entityTypeKey = '' } = useParams()
  const [entityType, setEntityType] = useState<BusinessEntityType | null>(null)
  const [entities, setEntities] = useState<BusinessEntity[] | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (query = '') => {
      if (!selectedBusiness) return
      setError(null)

      try {
        const [typeResponse, entityResponse] = await Promise.all([
          dashboardApi.getEntityType(selectedBusiness.id, entityTypeKey),
          dashboardApi.listEntities(selectedBusiness.id, entityTypeKey, query),
        ])
        setEntityType(typeResponse.entityType)
        setEntities(entityResponse.items)
      } catch (loadError) {
        setError(getErrorMessage(loadError))
      }
    },
    [entityTypeKey, selectedBusiness],
  )

  useEffect(() => {
    if (!selectedBusiness) return
    let isCurrent = true

    Promise.all([
      dashboardApi.getEntityType(selectedBusiness.id, entityTypeKey),
      dashboardApi.listEntities(selectedBusiness.id, entityTypeKey),
    ])
      .then(([typeResponse, entityResponse]) => {
        if (!isCurrent) return
        setEntityType(typeResponse.entityType)
        setEntities(entityResponse.items)
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(getErrorMessage(loadError))
      })

    return () => {
      isCurrent = false
    }
  }, [entityTypeKey, selectedBusiness])

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void load(search)
  }

  async function archive(entity: BusinessEntity) {
    if (!selectedBusiness || !window.confirm(`Archive ${entity.name}?`)) return

    try {
      await dashboardApi.archiveEntity(selectedBusiness.id, entityTypeKey, entity.id)
      setEntities((current) => current?.filter((item) => item.id !== entity.id) ?? null)
    } catch (archiveError) {
      setError(getErrorMessage(archiveError))
    }
  }

  if ((!entityType || !entities) && !error) return <LoadingBlock label="Loading records…" />

  const representativeFields = entityType?.fieldDefinitions?.filter((field) => field.enabled).slice(0, 3) ?? []

  return (
    <div className="page-stack">
      {entityType ? (
        <PageHeader
          eyebrow="Business data"
          title={entityType.name}
          description={entityType.description || `Manage active ${entityType.name.toLowerCase()} records.`}
          action={<Link className="primary-link-button" to={`/dashboard/data/${entityTypeKey}/new`}>Add record</Link>}
        />
      ) : null}
      <div className="toolbar">
        <form className="search-form" onSubmit={handleSearch} role="search">
          <label htmlFor="entity-search">Search by name</label>
          <div><input id="entity-search" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="secondary-button" type="submit">Search</button></div>
        </form>
        <Link className="text-link" to={`/dashboard/schema/${entityTypeKey}`}>Edit schema</Link>
      </div>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {entities?.length ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th scope="col">Name</th>{representativeFields.map((field) => <th key={field.id} scope="col">{field.label}</th>)}<th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {entities.map((entity) => (
                <tr key={entity.id}>
                  <th scope="row">{entity.name}</th>
                  {representativeFields.map((field) => <td key={field.id}>{formatValue(entity.data[field.key])}</td>)}
                  <td><div className="row-actions"><Link to={`/dashboard/data/${entityTypeKey}/${entity.id}/edit`}>Edit</Link><button className="text-button text-button--danger" onClick={() => void archive(entity)} type="button">Archive</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-list">No active records found.</p>
      )}
    </div>
  )
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}
