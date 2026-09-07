import { useEffect, useRef, useState, type FormEvent } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { AgentResult, BusinessSummary } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { StatusMessage } from '../components/StatusMessage'

type ChatMessage = {
  id: string
  role: 'customer' | 'assistant'
  content: string
  result?: AgentResult
}

const formatMetadata = (value: string) =>
  value.toLowerCase().replaceAll('_', ' ')

function AgentChatConversation({ selectedBusiness }: { selectedBusiness: BusinessSummary | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoadingConversation, setIsLoadingConversation] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const nextMessageId = useRef(0)
  const transcriptEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedBusiness) return

    let isCurrent = true
    dashboardApi.getAgentConversation(selectedBusiness.id)
      .then((response) => {
        if (!isCurrent) return
        setConversationId(response.conversation?.id)
        setMessages(response.conversation?.messages ?? [])
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (isCurrent) setIsLoadingConversation(false)
      })

    return () => {
      isCurrent = false
    }
  }, [selectedBusiness])

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, isSending])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = draft.trim()

    if (!selectedBusiness || !message || isSending) return

    const customerMessage: ChatMessage = {
      id: `local-customer-${nextMessageId.current++}`,
      role: 'customer',
      content: message,
    }
    setMessages((current) => [...current, customerMessage])
    setDraft('')
    setError(null)
    setIsSending(true)

    try {
      const response = await dashboardApi.sendAgentMessage(
        selectedBusiness.id,
        message,
        conversationId,
      )
      setConversationId(response.conversationId)
      setMessages((current) => [
        ...current,
        {
          id: `local-assistant-${nextMessageId.current++}`,
          role: 'assistant',
          content: response.result.reply,
          result: response.result,
        },
      ])
    } catch (sendError) {
      setError(getErrorMessage(sendError))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="page-stack agent-chat-page">
      <PageHeader
        eyebrow="Shared agent"
        title="Agent chat"
        description={`Continue the customer-service conversation for ${selectedBusiness?.name ?? 'the active business'} using its current tenant-bound data.`}
      />

      <section className="agent-chat" aria-label="Customer-service conversation">
        <div className="agent-chat__context">
          <strong>{selectedBusiness?.name}</strong>
          <span>The server verifies this business from your session and membership on every message.</span>
        </div>

        <div
          aria-busy={isSending}
          aria-live="polite"
          className="agent-chat__transcript"
          role="log"
        >
          {isLoadingConversation ? (
            <div className="agent-chat__empty" role="status">
              <p>Loading conversation…</p>
            </div>
          ) : null}

          {!isLoadingConversation && messages.length === 0 ? (
            <div className="agent-chat__empty">
              <p>Ask a customer-style question about opening hours, rules, prices, services, or availability.</p>
              <span>This conversation uses the same shared runtime and tenant-bound tools as future WhatsApp conversations.</span>
            </div>
          ) : null}

          {messages.map((message) => (
            <article
              className={`agent-message agent-message--${message.role}`}
              key={message.id}
            >
              <span className="agent-message__role">
                {message.role === 'customer' ? 'Customer' : 'Agent'}
              </span>
              <p>{message.content}</p>
              {message.result ? (
                <dl className="agent-message__metadata" aria-label="Response metadata">
                  <div><dt>Intent</dt><dd>{formatMetadata(message.result.detectedIntent)}</dd></div>
                  <div><dt>Language</dt><dd>{formatMetadata(message.result.detectedLanguage)}</dd></div>
                  <div>
                    <dt>Routing</dt>
                    <dd>{message.result.needsHuman ? 'Human review needed' : 'AI handled'}</dd>
                  </div>
                  {message.result.reasonCode !== 'NONE' ? (
                    <div><dt>Reason</dt><dd>{formatMetadata(message.result.reasonCode)}</dd></div>
                  ) : null}
                </dl>
              ) : null}
            </article>
          ))}

          {isSending ? (
            <div className="agent-message agent-message--assistant agent-message--pending" role="status">
              <span className="agent-message__role">Agent</span>
              <p>Preparing a response…</p>
            </div>
          ) : null}
          <div ref={transcriptEnd} />
        </div>

        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

        <form className="agent-composer" onSubmit={handleSubmit}>
          <label htmlFor="agent-message">Customer message</label>
          <textarea
            disabled={isLoadingConversation || isSending}
            id="agent-message"
            maxLength={4_000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="For example: What time do you close today?"
            rows={3}
            value={draft}
          />
          <div className="agent-composer__actions">
            <span>{draft.length.toLocaleString()} / 4,000</span>
            <button
              disabled={isLoadingConversation || isSending || !draft.trim()}
              type="submit"
            >
              {isSending ? 'Sending…' : 'Send message'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export function AgentChatPage() {
  const { selectedBusiness } = useBusiness()

  return (
    <AgentChatConversation
      key={selectedBusiness?.id ?? 'no-business'}
      selectedBusiness={selectedBusiness}
    />
  )
}
