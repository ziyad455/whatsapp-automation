import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { AttentionConversation } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const formatPhone = (phone: string) => phone.startsWith('+') ? phone : `+${phone}`
const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ')
const formatWaiting = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function AttentionQueuePage() {
  const { selectedBusiness } = useBusiness()
  const [items, setItems] = useState<AttentionConversation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedBusiness) return
    let current = true
    dashboardApi.getAttentionQueue(selectedBusiness.id)
      .then(({ conversations }) => { if (current) setItems(conversations) })
      .catch((reason: unknown) => { if (current) setError(getErrorMessage(reason)) })
    return () => { current = false }
  }, [selectedBusiness])
  return <div className="page-stack">
    <PageHeader eyebrow="Human handoff" title="Needs attention" description="Open WhatsApp conversations waiting for a staff response, ordered by longest wait." />
    {!items && !error ? <LoadingBlock label="Loading attention queue…" /> : null}
    {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
    {items?.length === 0 ? <p className="empty-list">No conversations are waiting for staff.</p> : null}
    {items && items.length > 0 ? <div className="attention-queue">{items.map(item => <Link className="attention-row" key={item.id} to={`/dashboard/conversations/${item.id}`}>
      <div><strong>{formatPhone(item.customer.whatsappPhone)}</strong><p>{item.latestMessage?.content ?? 'No message recorded'}</p></div>
      <dl><div><dt>Reason</dt><dd>{item.handoffReason ? label(item.handoffReason) : 'Human mode'}</dd></div><div><dt>Waiting</dt><dd><time dateTime={item.waitingSince} title={formatTime(item.waitingSince)}>{formatWaiting(item.waitingSince)}</time></dd></div><div><dt>Last activity</dt><dd><time dateTime={item.lastActivityAt}>{formatTime(item.lastActivityAt)}</time></dd></div><div><dt>Assigned</dt><dd>{item.assignment?.name ?? 'Unassigned'}</dd></div></dl>
    </Link>)}</div> : null}
  </div>
}
