import { useEffect, useState, type FormEvent } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { FollowUpSettings } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const fromTime = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function FollowUpSettingsPage() {
  const { selectedBusiness } = useBusiness()
  const [settings, setSettings] = useState<FollowUpSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!selectedBusiness) return
    let active = true
    dashboardApi.getFollowUpSettings(selectedBusiness.id)
      .then(({ settings: loaded }) => { if (active) setSettings(loaded) })
      .catch((reason: unknown) => { if (active) setError(getErrorMessage(reason)) })
    return () => { active = false }
  }, [selectedBusiness])

  function change<Key extends keyof FollowUpSettings>(key: Key, value: FollowUpSettings[Key]) {
    setSettings(current => current ? { ...current, [key]: value } : current)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBusiness || !settings) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await dashboardApi.updateFollowUpSettings(selectedBusiness.id, settings)
      setSettings(result.settings)
      setSuccess('Follow-up policy saved.')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return <div className="page-stack">
    <PageHeader eyebrow="Business settings" title="Follow-ups"
      description="Control when opted-in customers may receive a single, timely reminder about an active request." />
    {!settings && !error ? <LoadingBlock label="Loading follow-up settings…" /> : null}
    {settings ? <form className="settings-form" onSubmit={save}>
      <section className="settings-section">
        <div className="settings-section__intro">
          <h2>Policy</h2>
          <p>Disabled by default. Customer consent and Meta’s 24-hour text window are always checked before sending. Delays beyond that window need an approved template, which this version cannot send.</p>
        </div>
        <div className="form-grid">
          <label className="field field--wide">
            <span>Enable automatic follow-ups</span>
            <input type="checkbox" checked={settings.followUpsEnabled}
              onChange={event => change('followUpsEnabled', event.target.checked)} />
          </label>
          <label className="field">
            <span>Initial delay (minutes)</span>
            <input type="number" min={5} max={10080} required value={settings.initialFollowUpDelayMinutes}
              onChange={event => change('initialFollowUpDelayMinutes', Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Maximum sent per lead</span>
            <input type="number" min={1} max={3} required value={settings.maxFollowUpsPerLead}
              onChange={event => change('maxFollowUpsPerLead', Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Messaging starts (business local time)</span>
            <input type="time" required value={toTime(settings.followUpWindowStartMinutes)}
              onChange={event => change('followUpWindowStartMinutes', fromTime(event.target.value))} />
          </label>
          <label className="field">
            <span>Messaging ends (business local time)</span>
            <input type="time" required value={toTime(settings.followUpWindowEndMinutes)}
              onChange={event => change('followUpWindowEndMinutes', fromTime(event.target.value))} />
          </label>
          <label className="field">
            <span>Minimum customer interval (minutes)</span>
            <input type="number" min={60} max={10080} required
              value={settings.minimumFollowUpIntervalMinutes}
              onChange={event => change('minimumFollowUpIntervalMinutes', Number(event.target.value))} />
          </label>
        </div>
      </section>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {success ? <StatusMessage tone="success">{success}</StatusMessage> : null}
      <div className="form-actions">
        <button disabled={busy || selectedBusiness?.role !== 'OWNER'} type="submit">
          {busy ? 'Saving…' : 'Save follow-up policy'}
        </button>
      </div>
    </form> : error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
  </div>
}
