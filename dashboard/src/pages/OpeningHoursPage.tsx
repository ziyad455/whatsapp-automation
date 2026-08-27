import { useEffect, useState, type FormEvent } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { OpeningHour } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

export function OpeningHoursPage() {
  const { selectedBusiness } = useBusiness()
  const [hours, setHours] = useState<OpeningHour[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!selectedBusiness) return
    dashboardApi
      .getOpeningHours(selectedBusiness.id)
      .then((response) => setHours(response.hours))
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
  }, [selectedBusiness])

  function updateDay(index: number, update: Partial<OpeningHour>) {
    setHours((current) =>
      current?.map((hour, hourIndex) => {
        if (hourIndex !== index) return hour
        const next = { ...hour, ...update }
        return next.isOpen
          ? {
              ...next,
              opensAt: next.opensAt ?? '09:00',
              closesAt: next.closesAt ?? '18:00',
            }
          : { ...next, opensAt: null, closesAt: null }
      }) ?? null,
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBusiness || !hours) return
    const invalidDay = hours.find(
      (hour) => hour.isOpen && (!hour.opensAt || !hour.closesAt || hour.opensAt >= hour.closesAt),
    )

    if (invalidDay) {
      setError(`${formatDay(invalidDay.dayOfWeek)} must close later than it opens.`)
      return
    }

    setError(null)
    setSuccess(null)
    setIsSaving(true)

    try {
      const response = await dashboardApi.updateOpeningHours(selectedBusiness.id, hours)
      setHours(response.hours)
      setSuccess('Opening hours saved.')
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  if (!hours && !error) return <LoadingBlock label="Loading opening hours…" />

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Availability"
        title="Opening hours"
        description="Set the regular weekly schedule in the business's local time. Overnight and special schedules are not included yet."
      />
      {error && !hours ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {hours ? (
        <form className="settings-form" onSubmit={handleSubmit}>
          <section className="hours-list" aria-label="Weekly opening hours">
            {hours.map((hour, index) => (
              <div className="hours-row" key={hour.dayOfWeek}>
                <strong>{formatDay(hour.dayOfWeek)}</strong>
                <label className="switch-field">
                  <input checked={hour.isOpen} onChange={(event) => updateDay(index, { isOpen: event.target.checked })} type="checkbox" />
                  <span>{hour.isOpen ? 'Open' : 'Closed'}</span>
                </label>
                <label className="time-field">
                  <span>Opens</span>
                  <input disabled={!hour.isOpen} required={hour.isOpen} type="time" value={hour.opensAt ?? ''} onChange={(event) => updateDay(index, { opensAt: event.target.value })} />
                </label>
                <label className="time-field">
                  <span>Closes</span>
                  <input disabled={!hour.isOpen} required={hour.isOpen} type="time" value={hour.closesAt ?? ''} onChange={(event) => updateDay(index, { closesAt: event.target.value })} />
                </label>
              </div>
            ))}
          </section>
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
          {success ? <StatusMessage tone="success">{success}</StatusMessage> : null}
          <div className="form-actions">
            <button disabled={isSaving} type="submit">{isSaving ? 'Saving…' : 'Save hours'}</button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

function formatDay(day: OpeningHour['dayOfWeek']): string {
  return `${day.charAt(0)}${day.slice(1).toLowerCase()}`
}
