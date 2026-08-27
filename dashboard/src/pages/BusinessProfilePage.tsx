import { useEffect, useState, type FormEvent } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { BusinessProfile } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

type ProfileForm = Omit<BusinessProfile, 'id' | 'category' | 'supportedLanguages'> & {
  supportedLanguages: string
}

export function BusinessProfilePage() {
  const { selectedBusiness } = useBusiness()
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!selectedBusiness) return
    let isCurrent = true

    dashboardApi
      .getProfile(selectedBusiness.id)
      .then(({ profile }) => {
        if (!isCurrent) return
        setForm({
          name: profile.name,
          description: profile.description,
          phone: profile.phone,
          address: profile.address,
          currency: profile.currency,
          defaultLanguage: profile.defaultLanguage,
          supportedLanguages: profile.supportedLanguages.join(', '),
          timezone: profile.timezone,
        })
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(getErrorMessage(loadError))
      })

    return () => {
      isCurrent = false
    }
  }, [selectedBusiness])

  function updateField<Key extends keyof ProfileForm>(key: Key, value: ProfileForm[Key]) {
    setForm((current) => (current ? { ...current, [key]: value } : current))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBusiness || !form) return
    setError(null)
    setSuccess(null)
    setIsSaving(true)

    try {
      const supportedLanguages = form.supportedLanguages
        .split(',')
        .map((language) => language.trim())
        .filter(Boolean)
      const { profile } = await dashboardApi.updateProfile(selectedBusiness.id, {
        ...form,
        supportedLanguages,
      })
      setForm({
        name: profile.name,
        description: profile.description,
        phone: profile.phone,
        address: profile.address,
        currency: profile.currency,
        defaultLanguage: profile.defaultLanguage,
        supportedLanguages: profile.supportedLanguages.join(', '),
        timezone: profile.timezone,
      })
      setSuccess('Business profile saved.')
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  if (!form && !error) return <LoadingBlock label="Loading business profile…" />

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Business settings"
        title="Business profile"
        description="Core details the team and future assistant use to represent this business accurately."
      />
      {error && !form ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {form ? (
        <form className="settings-form" onSubmit={handleSubmit}>
          <section className="settings-section" aria-labelledby="profile-identity">
            <div className="settings-section__intro">
              <h2 id="profile-identity">Identity</h2>
              <p>Use the public-facing details customers should recognize.</p>
            </div>
            <div className="form-grid">
              <label className="field field--wide">
                <span>Business name</span>
                <input required value={form.name} onChange={(event) => updateField('name', event.target.value)} />
              </label>
              <label className="field field--wide">
                <span>Description</span>
                <textarea rows={4} value={form.description ?? ''} onChange={(event) => updateField('description', event.target.value)} />
                <small>A short factual description of what the business offers.</small>
              </label>
              <label className="field">
                <span>Phone</span>
                <input inputMode="tel" value={form.phone ?? ''} onChange={(event) => updateField('phone', event.target.value)} />
              </label>
              <label className="field">
                <span>Address</span>
                <input value={form.address ?? ''} onChange={(event) => updateField('address', event.target.value)} />
              </label>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="profile-localization">
            <div className="settings-section__intro">
              <h2 id="profile-localization">Locale and time</h2>
              <p>These settings keep prices, language, and schedules consistent.</p>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Currency</span>
                <input maxLength={3} required value={form.currency} onChange={(event) => updateField('currency', event.target.value.toUpperCase())} />
                <small>Three-letter code, for example MAD.</small>
              </label>
              <label className="field">
                <span>Timezone</span>
                <input required value={form.timezone} onChange={(event) => updateField('timezone', event.target.value)} />
                <small>For example Africa/Casablanca.</small>
              </label>
              <label className="field">
                <span>Default language</span>
                <input required value={form.defaultLanguage} onChange={(event) => updateField('defaultLanguage', event.target.value.toLowerCase())} />
              </label>
              <label className="field">
                <span>Supported languages</span>
                <input required value={form.supportedLanguages} onChange={(event) => updateField('supportedLanguages', event.target.value)} />
                <small>Comma-separated language codes, such as ar, fr, en.</small>
              </label>
            </div>
          </section>

          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
          {success ? <StatusMessage tone="success">{success}</StatusMessage> : null}
          <div className="form-actions">
            <button disabled={isSaving} type="submit">{isSaving ? 'Saving…' : 'Save profile'}</button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
