import { useEffect, useState, type FormEvent } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type {
  CustomerHistory,
  CustomerLifecycleEventType,
  CustomerSummary,
} from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const eventTypes: readonly CustomerLifecycleEventType[] = [
  'BOOKING_COMPLETED',
  'PURCHASE_COMPLETED',
  'MEMBERSHIP_STARTED',
  'MEMBERSHIP_EXPIRED',
  'SERVICE_COMPLETED',
]

const label = (value: string) => value.toLowerCase().replaceAll('_', ' ')
const dateTimeLocal = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function CustomersPage() {
  const { selectedBusiness } = useBusiness()
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [selected, setSelected] = useState<CustomerHistory | null>(null)
  const [eventType, setEventType] = useState<CustomerLifecycleEventType>('BOOKING_COMPLETED')
  const [occurredAt, setOccurredAt] = useState(dateTimeLocal(new Date()))
  const [itemLabel, setItemLabel] = useState('')
  const [evidence, setEvidence] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadCustomers = async () => {
    if (!selectedBusiness) return
    const response = await dashboardApi.listCustomers(selectedBusiness.id)
    setCustomers(response.customers)
  }

  useEffect(() => {
    if (!selectedBusiness) return
    let active = true
    dashboardApi.listCustomers(selectedBusiness.id)
      .then(response => { if (active) setCustomers(response.customers) })
      .catch((reason: unknown) => { if (active) setError(getErrorMessage(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedBusiness])

  const openHistory = async (customerId: string) => {
    if (!selectedBusiness) return
    setBusy(true)
    setError(null)
    try {
      const response = await dashboardApi.getCustomerHistory(selectedBusiness.id, customerId)
      setSelected(response.customer)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const addEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedBusiness || !selected) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await dashboardApi.createCustomerLifecycleEvent(selectedBusiness.id, selected.id, {
        type: eventType,
        occurredAt: new Date(occurredAt).toISOString(),
        ...(itemLabel.trim() ? { metadata: { itemLabel: itemLabel.trim() } } : {}),
      })
      const response = await dashboardApi.getCustomerHistory(selectedBusiness.id, selected.id)
      setSelected(response.customer)
      await loadCustomers()
      setItemLabel('')
      setSuccess('Customer outcome recorded.')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const updatePreference = async (consent: boolean) => {
    if (!selectedBusiness || !selected) return
    if (consent && !evidence.trim()) {
      setError('Record how the customer gave permission before enabling marketing messages.')
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await dashboardApi.recordMarketingPreference(
        selectedBusiness.id,
        selected.id,
        consent,
        consent ? evidence.trim() : undefined,
      )
      const response = await dashboardApi.getCustomerHistory(selectedBusiness.id, selected.id)
      setSelected(response.customer)
      await loadCustomers()
      setSuccess(consent ? 'Marketing consent recorded.' : 'Customer opted out of marketing messages.')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return <div className="page-stack">
    <PageHeader eyebrow="Customer records" title="Customer history"
      description="Review factual outcomes and manage promotional consent without searching old conversations." />
    {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
    {success ? <StatusMessage tone="success">{success}</StatusMessage> : null}
    {loading ? <LoadingBlock label="Loading customers…" /> : null}
    {!loading && customers.length === 0 ? <div className="empty-state">
      <h1>No WhatsApp customers yet</h1>
      <p>Customers will appear after the business receives a WhatsApp message.</p>
    </div> : null}
    {!loading && customers.length > 0 ? <div className="reactivation-layout">
      <section className="customer-directory" aria-label="Customers">
        {customers.map(customer => <button className={`customer-directory__row${selected?.id === customer.id ? ' customer-directory__row--active' : ''}`}
          disabled={busy} key={customer.id} onClick={() => void openHistory(customer.id)} type="button">
          <span><strong>{customer.whatsappPhone}</strong><small>{customer._count.lifecycleEvents} recorded outcomes</small></span>
          <span>{customer.marketingOptedOutAt ? 'Opted out' : customer.marketingConsentAt ? 'Consented' : 'No consent'}</span>
        </button>)}
      </section>
      <section className="customer-history" aria-live="polite">
        {!selected ? <div className="customer-history__empty">
          <h2>Select a customer</h2>
          <p>Choose a customer to review outcomes and communication permission.</p>
        </div> : <>
          <header className="section-heading">
            <div><h2>{selected.whatsappPhone}</h2><p>Promotional messaging: {selected.marketingOptedOutAt ? 'opted out' : selected.marketingConsentAt ? 'consented' : 'not permitted'}</p></div>
          </header>
          <div className="customer-preference">
            <label className="field">
              <span>Consent evidence</span>
              <input value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Where and when permission was obtained" />
            </label>
            <div>
              <button disabled={busy} onClick={() => void updatePreference(true)} type="button">Record consent</button>
              <button className="secondary-button" disabled={busy} onClick={() => void updatePreference(false)} type="button">Record opt-out</button>
            </div>
          </div>
          <form className="lifecycle-form" onSubmit={addEvent}>
            <h3>Record a completed outcome</h3>
            <label className="field"><span>Outcome</span><select value={eventType} onChange={event => setEventType(event.target.value as CustomerLifecycleEventType)}>
              {eventTypes.map(type => <option key={type} value={type}>{label(type)}</option>)}
            </select></label>
            <label className="field"><span>Occurred at</span><input type="datetime-local" required value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></label>
            <label className="field field--wide"><span>Item or service (optional)</span><input value={itemLabel} onChange={event => setItemLabel(event.target.value)} placeholder="For example, Renault Clio" /></label>
            <button disabled={busy} type="submit">Record outcome</button>
          </form>
          <div className="lifecycle-history">
            <h3>Outcome history</h3>
            {selected.lifecycleEvents.length === 0 ? <p>No completed outcomes have been recorded.</p> : <ol>
              {selected.lifecycleEvents.map(item => <li key={item.id}>
                <div><strong>{label(item.type)}</strong><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time></div>
                {item.relatedEntity ? <span>{item.relatedEntity.name}</span> : typeof item.metadata.itemLabel === 'string' ? <span>{item.metadata.itemLabel}</span> : null}
              </li>)}
            </ol>}
          </div>
        </>}
      </section>
    </div> : null}
  </div>
}
