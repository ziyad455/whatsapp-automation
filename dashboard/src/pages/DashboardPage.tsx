import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { CampaignPerformance, ConversationAnalytics, DashboardOverview, ReportingRange } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const ranges: Array<{ value: ReportingRange; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'LAST_7_DAYS', label: 'Last 7 days' },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
]
const formatPhone = (phone: string) => phone.startsWith('+') ? phone : `+${phone}`
const formatDateTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const formatPercent = (value: number | null) => value === null ? '—' : `${value}%`
const formatSeconds = (value: number | null) => value === null ? '—' : value < 60 ? `${value}s` : `${Math.floor(value / 60)}m ${value % 60}s`
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ')
const formatWaiting = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function DashboardPage() {
  const { selectedBusiness } = useBusiness()
  const [range, setRange] = useState<ReportingRange>('TODAY')
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignPerformance[] | null>(null)
  const [conversations, setConversations] = useState<ConversationAnalytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [secondaryError, setSecondaryError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedBusiness) return
    let current = true
    dashboardApi.getAnalyticsOverview(selectedBusiness.id, range)
      .then(({ overview: result }) => { if (current) setOverview(result) })
      .catch((reason: unknown) => { if (current) setError(getErrorMessage(reason)) })
    dashboardApi.getCampaignPerformance(selectedBusiness.id)
      .then(({ campaigns: result }) => { if (current) setCampaigns(result) })
      .catch((reason: unknown) => {
        if (current) setSecondaryError(`Campaign analytics: ${getErrorMessage(reason)}`)
      })
    dashboardApi.getConversationAnalytics(selectedBusiness.id, range)
      .then(({ analytics }) => { if (current) setConversations(analytics) })
      .catch((reason: unknown) => {
        if (current) setSecondaryError(`Conversation analytics: ${getErrorMessage(reason)}`)
      })
    return () => { current = false }
  }, [range, selectedBusiness])

  return <div className="page-stack operating-dashboard">
    <PageHeader eyebrow="Operations" title="Overview"
      description={`What needs attention and what changed for ${selectedBusiness?.name ?? 'this business'}.`}
      action={<label className="range-control"><span>Reporting period</span><select aria-label="Reporting period" value={range}
        onChange={event => {
          setOverview(null)
          setCampaigns(null)
          setConversations(null)
          setError(null)
          setSecondaryError(null)
          setRange(event.target.value as ReportingRange)
        }}>
        {ranges.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>} />
    {!overview && !error ? <LoadingBlock label="Loading operating overview…" /> : null}
    {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
    {overview ? <>
      <section className="metric-strip" aria-label="Operating summary">
        <div><span>Conversations</span><strong>{overview.summary.conversations}</strong></div>
        <div><span>New leads</span><strong>{overview.summary.newLeads}</strong></div>
        <div className={overview.summary.needsAttention > 0 ? 'metric-strip__urgent' : ''}><span>Needs attention</span><strong>{overview.summary.needsAttention}</strong></div>
        <div><span>Follow-ups due</span><strong>{overview.summary.followUpsDue}</strong></div>
        <div><span>Campaign conversions</span><strong>{overview.summary.campaignConversions}</strong></div>
      </section>
      <div className="operations-grid">
        <section className="operations-panel operations-panel--priority">
          <div className="section-heading"><div><h2>Needs attention</h2><p>Oldest waiting first</p></div><Link className="text-link" to="/dashboard/attention">View queue</Link></div>
          {overview.attention.length === 0 ? <p className="empty-list">No conversations are waiting for staff.</p> : <div className="operations-list">{overview.attention.map(item =>
            <Link className="operations-row" key={item.id} to={`/dashboard/conversations/${item.id}`}><div><strong>{formatPhone(item.customer.whatsappPhone)}</strong><span>{item.latestMessage?.content ?? 'No message recorded'}</span></div><div><span>{item.handoffReason ? label(item.handoffReason) : 'Human mode'}</span><time dateTime={item.waitingSince} title={formatDateTime(item.waitingSince)}>Waiting {formatWaiting(item.waitingSince)}</time></div></Link>)}</div>}
        </section>
        <section className="operations-panel">
          <div className="section-heading"><div><h2>Lead pipeline</h2><p>{overview.leads.active} active leads</p></div><Link className="text-link" to="/dashboard/leads">View leads</Link></div>
          <dl className="pipeline-list">{Object.entries(overview.leads.statuses).map(([status, count]) => <div key={status}><dt>{label(status)}</dt><dd>{count}</dd></div>)}</dl>
          {overview.leads.recent.length > 0 ? <div className="recent-leads"><span>Recent leads</span>{overview.leads.recent.slice(0, 3).map(lead =>
            <Link key={lead.id} to={`/dashboard/conversations/${lead.conversationId}`}><strong>{formatPhone(lead.customer.whatsappPhone)}</strong><small>{label(lead.status)} · {lead.summary ?? label(lead.intent)}</small></Link>)}</div> : null}
        </section>
      </div>
      <div className="operations-grid">
        <section className="operations-panel">
          <div className="section-heading"><div><h2>Follow-up health</h2><p>Current automation queue</p></div><Link className="text-link" to="/dashboard/follow-ups">Open follow-ups</Link></div>
          <dl className="compact-metrics"><div><dt>Due</dt><dd>{overview.followUps.due}</dd></div><div><dt>Pending</dt><dd>{overview.followUps.pending}</dd></div><div className={overview.followUps.failed > 0 ? 'metric-danger' : ''}><dt>Failed</dt><dd>{overview.followUps.failed}</dd></div></dl>
        </section>
        <section className="operations-panel">
          <div className="section-heading"><div><h2>Recent outcomes</h2><p>Recorded customer value</p></div><Link className="text-link" to="/dashboard/customers">View customers</Link></div>
          {overview.outcomes.length === 0 ? <p className="empty-list">No customer outcomes in this period.</p> : <div className="plain-operations-list">{overview.outcomes.map(outcome => <div key={outcome.id}><strong>{label(outcome.type)}</strong><span>{formatPhone(outcome.customer.whatsappPhone)} · {formatDateTime(outcome.occurredAt)}</span></div>)}</div>}
        </section>
      </div>
    </> : null}
    {secondaryError ? <StatusMessage tone="error">{`Some analytics could not be loaded: ${secondaryError}`}</StatusMessage> : null}
    {conversations ? <section className="operations-panel">
      <div className="section-heading"><div><h2>Conversation handling</h2><p>{conversations.conversationsWithCustomerMessages} customer conversations in this period</p></div></div>
      <dl className="compact-metrics compact-metrics--wide"><div><dt>Fully AI handled</dt><dd>{conversations.fullyAiHandled}</dd></div><div><dt>Human responses</dt><dd>{conversations.conversationsWithHumanResponses}</dd></div><div><dt>Handoffs</dt><dd>{conversations.conversationsRequiringHandoff}</dd></div><div><dt>Handoff rate</dt><dd>{formatPercent(conversations.handoffRate)}</dd></div><div><dt>Median first response</dt><dd>{formatSeconds(conversations.firstResponseTimeSeconds.median)}</dd></div><div><dt>Median human response</dt><dd>{formatSeconds(conversations.humanResponseTimeSeconds.median)}</dd></div></dl>
    </section> : null}
    {campaigns ? <section className="operations-panel">
      <div className="section-heading"><div><h2>Campaign performance</h2><p>Latest reactivation campaigns</p></div><Link className="text-link" to="/dashboard/campaigns">Manage campaigns</Link></div>
      {campaigns.length === 0 ? <p className="empty-list">No campaigns have been created.</p> : <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>Campaign</th><th>Sent</th><th>Delivered</th><th>Replies</th><th>Conversions</th></tr></thead><tbody>{campaigns.map(campaign => <tr key={campaign.id}><th>{campaign.name}<span>{label(campaign.status)}</span></th><td>{campaign.metrics.sent}</td><td>{campaign.metrics.delivered} <small>{formatPercent(campaign.rates.delivery)}</small></td><td>{campaign.metrics.replied} <small>{formatPercent(campaign.rates.reply)}</small></td><td>{campaign.metrics.converted} <small>{formatPercent(campaign.rates.conversion)}</small></td></tr>)}</tbody></table></div>}
    </section> : null}
  </div>
}
