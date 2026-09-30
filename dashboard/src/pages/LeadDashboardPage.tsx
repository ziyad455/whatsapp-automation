import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { LeadItem, LeadStatus } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const STATUSES: readonly LeadStatus[] = ['NEW', 'INTERESTED', 'QUALIFIED', 'WON', 'LOST']
type LeadFilter = LeadStatus | 'ALL'

const formatLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ')
const formatPhone = (phone: string) => phone.startsWith('+') ? phone : `+${phone}`
const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

export function LeadDashboardPage() {
  const { selectedBusiness } = useBusiness()
  const [filter, setFilter] = useState<LeadFilter>('ALL')
  const [leads, setLeads] = useState<LeadItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadLeads = useCallback(async () => {
    if (!selectedBusiness) return
    setIsLoading(true)
    setError(null)
    try {
      const response = await dashboardApi.listLeads(
        selectedBusiness.id,
        filter === 'ALL' ? undefined : filter,
      )
      setLeads(response.leads)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [filter, selectedBusiness])

  useEffect(() => {
    if (!selectedBusiness) return
    let isCurrent = true

    dashboardApi.listLeads(
      selectedBusiness.id,
      filter === 'ALL' ? undefined : filter,
    )
      .then(response => {
        if (isCurrent) setLeads(response.leads)
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [filter, selectedBusiness])

  const replaceLead = (updated: LeadItem) => {
    setLeads(current => {
      if (filter !== 'ALL' && updated.status !== filter) {
        return current.filter(lead => lead.id !== updated.id)
      }
      return current.map(lead => lead.id === updated.id ? updated : lead)
    })
  }

  const updateStatus = async (lead: LeadItem, status: LeadStatus) => {
    if (!selectedBusiness || status === lead.status) return
    setBusyLeadId(lead.id)
    setError(null)
    try {
      const response = await dashboardApi.setLeadStatus(selectedBusiness.id, lead.id, status)
      replaceLead(response.lead)
    } catch (updateError) {
      setError(getErrorMessage(updateError))
    } finally {
      setBusyLeadId(null)
    }
  }

  const refreshSummary = async (lead: LeadItem) => {
    if (!selectedBusiness) return
    setBusyLeadId(lead.id)
    setError(null)
    try {
      const response = await dashboardApi.refreshLeadSummary(selectedBusiness.id, lead.id)
      replaceLead(response.lead)
    } catch (refreshError) {
      setError(getErrorMessage(refreshError))
    } finally {
      setBusyLeadId(null)
    }
  }

  const updateConsent = async (lead: LeadItem, consent: boolean) => {
    if (!selectedBusiness) return
    if (consent && !window.confirm(
      'Confirm this customer explicitly agreed to WhatsApp follow-up messages from this business. Do not record consent based only on a purchase inquiry.',
    )) return
    setBusyLeadId(lead.id)
    setError(null)
    try {
      await dashboardApi.recordFollowUpConsent(selectedBusiness.id, lead.id, consent)
      await loadLeads()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusyLeadId(null)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Commercial opportunities"
        title="Leads"
        description={`Track meaningful purchase and booking interest for ${selectedBusiness?.name ?? 'the active business'} without losing the source conversation.`}
        action={(
          <button className="secondary-button" disabled={isLoading} onClick={() => void loadLeads()} type="button">
            Refresh
          </button>
        )}
      />

      <div className="lead-filters" aria-label="Filter Leads by status">
        {(['ALL', ...STATUSES] as const).map(status => (
          <button
            aria-pressed={filter === status}
            className={filter === status ? 'lead-filter lead-filter--active' : 'lead-filter'}
            key={status}
            onClick={() => {
              setError(null)
              setIsLoading(true)
              setFilter(status)
            }}
            type="button"
          >
            {formatLabel(status)}
          </button>
        ))}
      </div>

      {isLoading ? <LoadingBlock label="Loading Leads…" /> : null}
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

      {!isLoading && leads.length === 0 ? (
        <div className="empty-state">
          <p className="eyebrow">No opportunities here</p>
          <h1>No matching Leads</h1>
          <p>Meaningful purchase or booking intent from customer conversations will appear here.</p>
        </div>
      ) : null}

      {!isLoading && leads.length > 0 ? (
        <section className="lead-list" aria-label="Leads">
          {leads.map(lead => (
            <article className={`lead-row lead-row--${lead.status.toLowerCase()}`} key={lead.id}>
              <div className="lead-row__heading">
                <div>
                  <strong>{formatPhone(lead.customer.whatsappPhone)}</strong>
                  <span>{formatLabel(lead.intent)}</span>
                </div>
                <span className={`lead-status lead-status--${lead.status.toLowerCase()}`}>
                  {formatLabel(lead.status)}
                </span>
              </div>

              <p className={lead.summary ? 'lead-summary' : 'lead-summary lead-summary--pending'}>
                {lead.summary ?? 'Summary pending. The Lead and its evidence are safely stored.'}
              </p>

              {lead.summaryDetails?.keyFacts.length ? (
                <dl className="lead-facts">
                  {lead.summaryDetails.keyFacts.slice(0, 4).map(fact => (
                    <div key={`${fact.label}:${fact.value}`}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <div className="lead-evidence">
                <span>{lead.evidence.length} evidence {lead.evidence.length === 1 ? 'message' : 'messages'}</span>
                {lead.evidence.slice(-2).map(item => (
                  <q key={item.id}>{item.message.content}</q>
                ))}
              </div>

              <div className="lead-row__meta">
                {lead.customer.followUpConsentAt && !lead.customer.followUpOptedOutAt
                  ? <span>WhatsApp follow-up consent recorded</span>
                  : <span>No follow-up consent recorded</span>}
                {lead.followUps[0] ? <span>
                  Follow-up {formatLabel(lead.followUps[0].status)} · {formatTime(lead.followUps[0].scheduledAt)}
                  {lead.followUps[0].reasonCode ? ` · ${formatLabel(lead.followUps[0].reasonCode)}` : ''}
                </span> : null}
              </div>

              <div className="lead-row__footer">
                <div className="lead-row__meta">
                  <time dateTime={lead.lastActivityAt}>Active {formatTime(lead.lastActivityAt)}</time>
                  <span>{lead.conversation.mode} conversation</span>
                  {lead.conversation.handoffReason ? <span>{formatLabel(lead.conversation.handoffReason)}</span> : null}
                  {lead.statusSource === 'MANUAL' ? <span>Staff controlled</span> : null}
                </div>
                <div className="lead-row__actions">
                  <button className="secondary-button" disabled={busyLeadId === lead.id}
                    onClick={() => void updateConsent(lead,
                      !(lead.customer.followUpConsentAt && !lead.customer.followUpOptedOutAt))}
                    type="button">
                    {lead.customer.followUpConsentAt && !lead.customer.followUpOptedOutAt
                      ? 'Withdraw follow-up consent' : 'Record explicit opt-in'}
                  </button>
                  <label>
                    <span className="visually-hidden">Status for {formatPhone(lead.customer.whatsappPhone)}</span>
                    <select
                      aria-label={`Status for ${formatPhone(lead.customer.whatsappPhone)}`}
                      disabled={busyLeadId === lead.id}
                      onChange={event => void updateStatus(lead, event.target.value as LeadStatus)}
                      value={lead.status}
                    >
                      {STATUSES.map(status => <option key={status} value={status}>{formatLabel(status)}</option>)}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    disabled={busyLeadId === lead.id}
                    onClick={() => void refreshSummary(lead)}
                    type="button"
                  >
                    Refresh summary
                  </button>
                  <Link className="secondary-link" to={`/dashboard/conversations/${lead.conversation.id}`}>
                    Open conversation
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  )
}
