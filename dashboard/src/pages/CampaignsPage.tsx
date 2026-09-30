import { useEffect, useState, type FormEvent } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type {
  CampaignPreview,
  CampaignSummary,
  CustomerLifecycleEventType,
  ReactivationSegment,
} from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

type SegmentKind = ReactivationSegment['kind']
const eventTypes: readonly CustomerLifecycleEventType[] = [
  'BOOKING_COMPLETED', 'PURCHASE_COMPLETED', 'MEMBERSHIP_STARTED',
  'MEMBERSHIP_EXPIRED', 'SERVICE_COMPLETED',
]
const format = (value: string) => value.toLowerCase().replaceAll('_', ' ')

const buildSegment = (
  kind: SegmentKind,
  eventType: CustomerLifecycleEventType,
  days: number,
): ReactivationSegment => {
  if (kind === 'PRIOR_LIFECYCLE') return { kind, eventTypes: [eventType] }
  if (kind === 'INACTIVE') return { kind, minimumInactiveDays: days, eventTypes: [eventType] }
  if (kind === 'MEMBERSHIP_EXPIRING') return { kind, withinDays: days }
  if (kind === 'MEMBERSHIP_EXPIRED') return { kind }
  return { kind, minimumDays: days }
}

export function CampaignsPage() {
  const { selectedBusiness } = useBusiness()
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [preview, setPreview] = useState<CampaignPreview | null>(null)
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SegmentKind>('PRIOR_LIFECYCLE')
  const [eventType, setEventType] = useState<CustomerLifecycleEventType>('BOOKING_COMPLETED')
  const [days, setDays] = useState(60)
  const [templateName, setTemplateName] = useState('')
  const [templateLanguage, setTemplateLanguage] = useState('fr')
  const [templateBody, setTemplateBody] = useState('')
  const [parameters, setParameters] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = async () => {
    if (!selectedBusiness) return
    const response = await dashboardApi.listCampaigns(selectedBusiness.id)
    setCampaigns(response.campaigns)
  }

  useEffect(() => {
    if (!selectedBusiness) return
    let active = true
    dashboardApi.listCampaigns(selectedBusiness.id)
      .then(response => { if (active) setCampaigns(response.campaigns) })
      .catch((reason: unknown) => { if (active) setError(getErrorMessage(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedBusiness])

  const createAndPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedBusiness) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const created = await dashboardApi.createCampaign(selectedBusiness.id, {
        name,
        segmentDefinition: buildSegment(kind, eventType, days),
        templateName,
        templateLanguage,
        templateBody,
        templateParameters: parameters.split('\n').map(value => value.trim()).filter(Boolean),
      })
      const response = await dashboardApi.previewCampaign(selectedBusiness.id, created.campaign.id)
      setActiveCampaignId(created.campaign.id)
      setPreview(response.preview)
      await load()
      setSuccess('Draft created. Review recipients and exclusions before approval.')
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (campaignId: string, action: 'preview' | 'prepare' | 'launch' | 'cancel') => {
    if (!selectedBusiness) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      if (action === 'preview') {
        const response = await dashboardApi.previewCampaign(selectedBusiness.id, campaignId)
        setPreview(response.preview)
        setActiveCampaignId(campaignId)
      } else if (action === 'prepare') {
        const response = await dashboardApi.prepareCampaign(selectedBusiness.id, campaignId)
        setPreview(response.prepare)
        setActiveCampaignId(campaignId)
        setSuccess('Recipient snapshot approved. Launch remains a separate action.')
      } else if (action === 'launch') {
        await dashboardApi.launchCampaign(selectedBusiness.id, campaignId)
        setSuccess('Campaign queued. Every recipient will be checked again before sending.')
      } else {
        await dashboardApi.cancelCampaign(selectedBusiness.id, campaignId)
        setSuccess('Campaign cancelled.')
      }
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const statusActions = (campaign: CampaignSummary): Array<'preview' | 'prepare' | 'launch' | 'cancel'> => {
    if (campaign.status === 'DRAFT') return ['preview', 'prepare', 'cancel']
    if (campaign.status === 'READY') return ['preview', 'launch', 'cancel']
    if (campaign.status === 'SENDING') return ['cancel']
    return ['preview']
  }

  return <div className="page-stack campaign-page">
    <PageHeader eyebrow="Customer reactivation" title="Campaigns"
      description="Build a deterministic audience, verify permission and Meta eligibility, then launch from an approved recipient snapshot." />
    {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
    {success ? <StatusMessage tone="success">{success}</StatusMessage> : null}
    <form className="settings-form" onSubmit={createAndPreview}>
      <section className="settings-section">
        <div className="settings-section__intro"><h2>Audience</h2><p>Matching a segment does not grant permission to send.</p></div>
        <div className="form-grid">
          <label className="field field--wide"><span>Campaign name</span><input required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
          <label className="field"><span>Segment</span><select value={kind} onChange={event => setKind(event.target.value as SegmentKind)}>
            <option value="PRIOR_LIFECYCLE">Previous customer outcome</option>
            <option value="INACTIVE">Inactive customer</option>
            <option value="MEMBERSHIP_EXPIRING">Membership expiring</option>
            <option value="MEMBERSHIP_EXPIRED">Membership expired</option>
            <option value="SERVICE_DUE">Service due</option>
          </select></label>
          {(kind === 'PRIOR_LIFECYCLE' || kind === 'INACTIVE') ? <label className="field"><span>Required outcome</span><select value={eventType} onChange={event => setEventType(event.target.value as CustomerLifecycleEventType)}>
            {eventTypes.map(type => <option key={type} value={type}>{format(type)}</option>)}
          </select></label> : null}
          {kind !== 'PRIOR_LIFECYCLE' && kind !== 'MEMBERSHIP_EXPIRED' ? <label className="field"><span>{kind === 'MEMBERSHIP_EXPIRING' ? 'Within days' : 'Minimum days'}</span><input type="number" min={1} max={3650} required value={days} onChange={event => setDays(Number(event.target.value))} /></label> : null}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section__intro"><h2>Approved Meta template</h2><p>The server verifies approval and the MARKETING category before preparing or sending.</p></div>
        <div className="form-grid">
          <label className="field"><span>Template name</span><input required pattern="[a-z0-9_]+" value={templateName} onChange={event => setTemplateName(event.target.value)} /></label>
          <label className="field"><span>Language code</span><input required value={templateLanguage} onChange={event => setTemplateLanguage(event.target.value)} /></label>
          <label className="field field--wide"><span>Final template body</span><textarea required rows={4} value={templateBody} onChange={event => setTemplateBody(event.target.value)} placeholder="Use {{1}}, {{2}} for positional parameters." /></label>
          <label className="field field--wide"><span>Parameter values, one per line</span><textarea rows={3} value={parameters} onChange={event => setParameters(event.target.value)} placeholder="Leave empty when the template has no parameters." /></label>
        </div>
      </section>
      <div className="form-actions"><button disabled={busy || selectedBusiness?.role !== 'OWNER'} type="submit">{busy ? 'Checking…' : 'Create draft and preview'}</button></div>
    </form>
    {preview ? <section className="campaign-preview" aria-live="polite">
      <header className="section-heading"><div><h2>Recipient preview</h2><p>{preview.eligibleCount} eligible of {preview.matchedCount} matched</p></div><span>{preview.template.status.toLowerCase()}</span></header>
      <div className="campaign-preview__message"><span>Final message</span><p>{preview.finalMessage}</p></div>
      {preview.warnings.length ? <ul className="campaign-warnings">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Why matched</th><th>Eligibility</th></tr></thead><tbody>
        {preview.recipients.map(recipient => <tr key={recipient.customerId}><th>{recipient.whatsappPhone}</th><td>{recipient.matchedReasons.join(', ')}</td><td>{format(recipient.eligibility)}</td></tr>)}
      </tbody></table></div>
      {activeCampaignId && preview.eligibleCount > 0 ? <div className="campaign-preview__actions"><button disabled={busy || selectedBusiness?.role !== 'OWNER'} onClick={() => void runAction(activeCampaignId, 'prepare')} type="button">Approve recipient snapshot</button></div> : null}
    </section> : null}
    <section>
      <header className="section-heading"><h2>Campaign history</h2><span>Real transport outcomes</span></header>
      {loading ? <LoadingBlock label="Loading campaigns…" /> : null}
      {!loading && campaigns.length === 0 ? <p className="record-list__empty">No campaigns have been created.</p> : null}
      {!loading && campaigns.length > 0 ? <div className="campaign-list">
        {campaigns.map(campaign => <article className="campaign-row" key={campaign.id}>
          <div className="campaign-row__main"><div><strong>{campaign.name}</strong><span>{format(campaign.status)}</span></div><p>{campaign.templateName} · {campaign.templateLanguage} · template {format(campaign.templateStatus)}</p></div>
          <dl className="campaign-metrics"><div><dt>Recipients</dt><dd>{campaign.metrics.recipients}</dd></div><div><dt>Sent</dt><dd>{campaign.metrics.sent}</dd></div><div><dt>Delivered</dt><dd>{campaign.metrics.delivered}</dd></div><div><dt>Read</dt><dd>{campaign.metrics.read}</dd></div><div><dt>Replied</dt><dd>{campaign.metrics.replied}</dd></div><div><dt>Failed</dt><dd>{campaign.metrics.failed}</dd></div><div><dt>Converted</dt><dd>{campaign.metrics.converted}</dd></div></dl>
          <div className="campaign-row__actions">{statusActions(campaign).map(action => <button className={action === 'launch' ? '' : 'secondary-button'} disabled={busy || (action !== 'preview' && selectedBusiness?.role !== 'OWNER')} key={action} onClick={() => void runAction(campaign.id, action)} type="button">{action === 'prepare' ? 'Approve snapshot' : action}</button>)}</div>
        </article>)}
      </div> : null}
    </section>
  </div>
}
