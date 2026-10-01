import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { ConversationDetail, ConversationMode } from '../api/types'
import { useBusiness } from '../business/business-context'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const formatLabel = (value: string) =>
  value.toLowerCase().replaceAll('_', ' ')

const formatPhone = (phone: string) => phone.startsWith('+') ? phone : `+${phone}`

const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

const senderLabel = (senderType: string) => {
  if (senderType === 'CUSTOMER') return 'Customer'
  if (senderType === 'AI') return 'AI agent'
  if (senderType === 'HUMAN') return 'Staff'
  return 'System'
}

export function ConversationDetailPage() {
  const { conversationId } = useParams()
  const { selectedBusiness } = useBusiness()
  const [conversation, setConversation] = useState<ConversationDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transcriptEnd = useRef<HTMLDivElement>(null)

  const loadConversation = useCallback(async () => {
    if (!selectedBusiness || !conversationId) return
    setIsLoading(true)
    try {
      const response = await dashboardApi.getConversation(
        selectedBusiness.id,
        conversationId,
      )
      setConversation(response.conversation)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [conversationId, selectedBusiness])

  useEffect(() => {
    if (!selectedBusiness || !conversationId) return
    let isCurrent = true

    dashboardApi.getConversation(selectedBusiness.id, conversationId)
      .then((response) => {
        if (isCurrent) setConversation(response.conversation)
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
  }, [conversationId, selectedBusiness])

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [conversation?.messages.length])

  async function changeMode(mode: ConversationMode) {
    if (!selectedBusiness || !conversationId || isUpdating) return
    setIsUpdating(true)
    setError(null)
    try {
      const response = await dashboardApi.setConversationMode(
        selectedBusiness.id,
        conversationId,
        mode,
      )
      setConversation(response.conversation)
    } catch (modeError) {
      setError(getErrorMessage(modeError))
      await loadConversation()
    } finally {
      setIsUpdating(false)
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!selectedBusiness || !conversationId || !content || isUpdating) return
    setIsUpdating(true)
    setError(null)
    try {
      await dashboardApi.sendConversationReply(
        selectedBusiness.id,
        conversationId,
        content,
      )
      setDraft('')
      await loadConversation()
    } catch (sendError) {
      setError(getErrorMessage(sendError))
      await loadConversation()
    } finally {
      setIsUpdating(false)
    }
  }

  if (isLoading && !conversation) {
    return <LoadingBlock label="Loading conversation…" />
  }

  if (!conversation) {
    return (
      <div className="page-stack">
        <Link className="text-link" to="/dashboard/conversations">← Back to inbox</Link>
        <StatusMessage tone="error">{error ?? 'Conversation was not found.'}</StatusMessage>
      </div>
    )
  }

  return (
    <div className="page-stack conversation-detail-page">
      <div className="conversation-detail__heading">
        <div>
          <Link className="text-link" to="/dashboard/conversations">← Back to inbox</Link>
          <p className="eyebrow">WhatsApp conversation</p>
          <h1>{formatPhone(conversation.customer.whatsappPhone)}</h1>
          <p>Last activity {formatTime(conversation.lastActivityAt)}</p>
        </div>
        <div className="conversation-controls" aria-label="Conversation controls">
          {conversation.mode !== 'HUMAN' ? (
            <button disabled={isUpdating} onClick={() => void changeMode('HUMAN')} type="button">
              Take over
            </button>
          ) : null}
          {conversation.mode !== 'AI' ? (
            <button className="secondary-button" disabled={isUpdating} onClick={() => void changeMode('AI')} type="button">
              Return to AI
            </button>
          ) : null}
          {conversation.mode !== 'PAUSED' ? (
            <button className="secondary-button" disabled={isUpdating} onClick={() => void changeMode('PAUSED')} type="button">
              Pause
            </button>
          ) : null}
          <button className="text-button" disabled={isUpdating} onClick={() => void loadConversation()} type="button">
            Refresh
          </button>
        </div>
      </div>

      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

      <section className="conversation-summary" aria-label="Conversation status">
        <div><span>Mode</span><strong className={`conversation-mode conversation-mode--${conversation.mode.toLowerCase()}`}>{conversation.mode}</strong></div>
        <div><span>Attention</span><strong>{conversation.handoffReason ? formatLabel(conversation.handoffReason) : 'None'}</strong></div>
        <div><span>Assigned to</span><strong>{conversation.assignment?.name ?? 'Unassigned'}</strong></div>
        <div><span>Status</span><strong>{formatLabel(conversation.status)}</strong></div>
      </section>

      <section className="customer-context" aria-labelledby="customer-context-title">
        <div className="section-heading"><div><h2 id="customer-context-title">Recent customer outcomes</h2><p>Verified lifecycle events for this customer</p></div></div>
        {conversation.recentOutcomes.length === 0 ? <p className="empty-list">No customer outcomes have been recorded.</p> :
          <div className="plain-operations-list">{conversation.recentOutcomes.map(outcome => <div key={outcome.id}>
            <strong>{formatLabel(outcome.type)}</strong><time dateTime={outcome.occurredAt}>{formatTime(outcome.occurredAt)}</time>
          </div>)}</div>}
      </section>

      <section className="conversation-thread" aria-label="Message history">
        <div className="conversation-thread__messages" role="log">
          {conversation.messages.length === 0 ? (
            <p className="empty-list">No messages have been recorded.</p>
          ) : null}
          {conversation.messages.map((message) => (
            <article
              className={`conversation-message conversation-message--${message.senderType.toLowerCase()}`}
              key={message.id}
            >
              <div className="conversation-message__meta">
                <strong>{senderLabel(message.senderType)}</strong>
                {message.sentBy ? <span>{message.sentBy.name}</span> : null}
                <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
              </div>
              <p>{message.content}</p>
              {message.transport?.deliveryStatus ? (
                <span className={`transport-status transport-status--${message.transport.deliveryStatus.toLowerCase()}`}>
                  {formatLabel(message.transport.deliveryStatus)}
                  {message.transport.failureTitle ? ` — ${message.transport.failureTitle}` : ''}
                </span>
              ) : null}
            </article>
          ))}
          <div ref={transcriptEnd} />
        </div>

        <form className="conversation-reply" onSubmit={sendReply}>
          <label htmlFor="manual-reply">Staff reply</label>
          <textarea
            disabled={conversation.mode !== 'HUMAN' || isUpdating}
            id="manual-reply"
            maxLength={4_000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={conversation.mode === 'HUMAN'
              ? 'Write a reply to this customer…'
              : 'Take over the conversation to reply manually.'}
            rows={3}
            value={draft}
          />
          <div className="agent-composer__actions">
            <span>{draft.length.toLocaleString()} / 4,000</span>
            <button
              disabled={conversation.mode !== 'HUMAN' || isUpdating || !draft.trim()}
              type="submit"
            >
              {isUpdating ? 'Working…' : 'Send via WhatsApp'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
