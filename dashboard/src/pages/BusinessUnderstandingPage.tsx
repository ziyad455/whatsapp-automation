import { useEffect, useState } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { BusinessUnderstanding } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

export function BusinessUnderstandingPage() {
  const { selectedBusiness } = useBusiness()
  const [preview, setPreview] = useState<BusinessUnderstanding | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedBusiness) return
    dashboardApi
      .getBusinessUnderstanding(selectedBusiness.id)
      .then((response) => setPreview(response.preview))
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
  }, [selectedBusiness])

  if (!preview && !error) return <LoadingBlock label="Assembling business understanding…" />

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Read-only preview"
        title="Business understanding"
        description="A deterministic view assembled from current profile, schedule, rules, schemas, and active records. No AI is used here."
      />
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {preview ? (
        <div className="understanding-grid">
          <section className="understanding-section"><h2>Profile</h2>{preview.profile ? <dl className="definition-list"><div><dt>Name</dt><dd>{preview.profile.name}</dd></div><div><dt>Category</dt><dd>{preview.profile.category}</dd></div><div><dt>Timezone</dt><dd>{preview.profile.timezone}</dd></div><div><dt>Languages</dt><dd>{preview.profile.supportedLanguages.join(', ') || '—'}</dd></div><div><dt>Contact</dt><dd>{[preview.profile.phone, preview.profile.address].filter(Boolean).join(' · ') || '—'}</dd></div></dl> : <p>Profile unavailable.</p>}</section>
          <section className="understanding-section"><h2>Regular hours</h2><div className="preview-hours">{preview.openingHours.map((hour) => <div key={hour.dayOfWeek}><span>{formatDay(hour.dayOfWeek)}</span><strong>{hour.isOpen ? `${hour.opensAt}–${hour.closesAt}` : 'Closed'}</strong></div>)}</div></section>
          <section className="understanding-section"><h2>Active rules</h2>{preview.activeRules.length ? <ul className="plain-list">{preview.activeRules.map((rule) => <li key={`${rule.category}-${rule.name}`}><span>{rule.category}</span><strong>{rule.name}</strong><p>{rule.content}</p></li>)}</ul> : <p>No active rules.</p>}</section>
          <section className="understanding-section understanding-section--wide"><h2>Dynamic business data</h2>{preview.entityTypes.length ? <div className="preview-types">{preview.entityTypes.map((type) => <article key={type.key}><div className="record-row__meta"><span>{type.key}</span><span>Schema v{type.schemaVersion}</span><span>{type.activeEntityCount} active</span></div><h3>{type.name}</h3><p>{type.fieldDefinitions.map((field) => field.label).join(' · ') || 'No enabled fields'}</p>{type.representativeEntities.length ? <ul>{type.representativeEntities.map((entity) => <li key={entity.name}><strong>{entity.name}</strong><span>{Object.values(entity.data).slice(0, 3).map(String).join(' · ')}</span></li>)}</ul> : <span className="muted-text">No representative records.</span>}</article>)}</div> : <p>No dynamic data types.</p>}</section>
        </div>
      ) : null}
    </div>
  )
}

function formatDay(day: string): string {
  return `${day.charAt(0)}${day.slice(1).toLowerCase()}`
}
