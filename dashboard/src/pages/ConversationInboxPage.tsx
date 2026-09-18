import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { ConversationInboxItem } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const formatLabel = (value: string) =>
  value.toLowerCase().replaceAll('_', ' ')

const formatPhone = (phone: string) => phone.startsWith('+') ? phone : `+${phone}`

const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

export function ConversationInboxPage() {
  const { selectedBusiness } = useBusiness()
  const [conversations, setConversations] = useState<ConversationInboxItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadConversations = useCallback(async () => {
    if (!selectedBusiness) return
    setIsLoading(true)
    setError(null)
    try {
      const response = await dashboardApi.listConversations(selectedBusiness.id)
      setConversations(response.conversations)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [selectedBusiness])

  useEffect(() => {
    if (!selectedBusiness) return
    let isCurrent = true

    dashboardApi.listConversations(selectedBusiness.id)
      .then((response) => {
        if (isCurrent) setConversations(response.conversations)
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
  }, [selectedBusiness])

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Customer conversations"
        title="Inbox"
        description={`Review WhatsApp conversations for ${selectedBusiness?.name ?? 'the active business'}, take over when needed, and reply from one shared history.`}
        action={(
          <button className="secondary-button" disabled={isLoading} onClick={() => void loadConversations()} type="button">
            Refresh
          </button>
        )}
      />

      {isLoading ? <LoadingBlock label="Loading conversations…" /> : null}
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

      {!isLoading && !error && conversations.length === 0 ? (
        <div className="empty-state">
          <p className="eyebrow">Inbox clear</p>
          <h1>No WhatsApp conversations yet</h1>
          <p>New customer messages will appear here after Meta delivers them to this business.</p>
        </div>
      ) : null}

      {!isLoading && !error && conversations.length > 0 ? (
        <section className="conversation-list" aria-label="WhatsApp conversations">
          {conversations.map((conversation) => (
            <Link
              className={`conversation-row${conversation.attentionRequired ? ' conversation-row--attention' : ''}`}
              key={conversation.id}
              to={`/dashboard/conversations/${conversation.id}`}
            >
              <div className="conversation-row__identity">
                <strong>{formatPhone(conversation.customer.whatsappPhone)}</strong>
                <span>{conversation.latestMessage?.content ?? 'No messages yet'}</span>
              </div>
              <div className="conversation-row__state">
                <span className={`conversation-mode conversation-mode--${conversation.mode.toLowerCase()}`}>
                  {conversation.mode}
                </span>
                {conversation.handoffReason ? (
                  <span className="conversation-reason">{formatLabel(conversation.handoffReason)}</span>
                ) : null}
                <time dateTime={conversation.lastActivityAt}>{formatTime(conversation.lastActivityAt)}</time>
                <span>{conversation.assignment?.name ?? 'Unassigned'}</span>
              </div>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  )
}
