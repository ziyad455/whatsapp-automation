import { useEffect, useRef, useState, type FormEvent } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { AgentDiagnostics, AgentResult, BusinessSummary } from '../api/types'
import { useBusiness } from '../business/business-context'
import { PageHeader } from '../components/PageHeader'
import { StatusMessage } from '../components/StatusMessage'

interface PlaygroundMessage {
  id: string
  role: 'customer' | 'assistant'
  content: string
  result?: AgentResult
  diagnostics?: AgentDiagnostics
}

const formatMetadata = (value: string) =>
  value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase()

function Playground({ selectedBusiness }: { selectedBusiness: BusinessSummary }) {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([])
  const [conversationId, setConversationId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const nextMessageId = useRef(0)
  const transcriptEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let isCurrent = true
    dashboardApi.getAiPlaygroundConversation(selectedBusiness.id)
      .then(({ conversation }) => {
        if (!isCurrent) return
        setConversationId(conversation?.id)
        setMessages(conversation?.messages ?? [])
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })
    return () => { isCurrent = false }
  }, [selectedBusiness.id])

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, isSending])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || isSending) return

    setMessages(current => [...current, {
      id: `local-customer-${nextMessageId.current++}`,
      role: 'customer',
      content: message,
    }])
    setDraft('')
    setError(null)
    setIsSending(true)
    try {
      const response = await dashboardApi.sendAiPlaygroundMessage(
        selectedBusiness.id,
        message,
        conversationId,
      )
      setConversationId(response.conversationId)
      setMessages(current => [...current, {
        id: `local-assistant-${nextMessageId.current++}`,
        role: 'assistant',
        content: response.result.reply,
        result: response.result,
        diagnostics: response.diagnostics,
      }])
    } catch (sendError) {
      setError(getErrorMessage(sendError))
    } finally {
      setIsSending(false)
    }
  }

  async function handleReset() {
    setIsResetting(true)
    setError(null)
    try {
      await dashboardApi.resetAiPlayground(selectedBusiness.id)
      setConversationId(undefined)
      setMessages([])
    } catch (resetError) {
      setError(getErrorMessage(resetError))
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <div className="page-stack agent-chat-page">
      <PageHeader
        eyebrow="Development tool"
        title="AI playground"
        description={`Simulate a customer conversation for ${selectedBusiness.name} through the real shared runtime.`}
        action={(
          <button
            className="secondary-button"
            disabled={isLoading || isSending || isResetting || messages.length === 0}
            onClick={handleReset}
            type="button"
          >
            {isResetting ? 'Resetting…' : 'New simulation'}
          </button>
        )}
      />

      <section className="agent-chat" aria-label="AI conversation simulator">
        <div className="agent-chat__context">
          <strong>{selectedBusiness.name}</strong>
          <span>Development only · tenant-authorized · bounded conversation history</span>
        </div>

        <div aria-busy={isSending} aria-live="polite" className="agent-chat__transcript" role="log">
          {isLoading ? <div className="agent-chat__empty" role="status"><p>Loading simulation…</p></div> : null}
          {!isLoading && messages.length === 0 ? (
            <div className="agent-chat__empty">
              <p>Send realistic customer messages, then continue with follow-up questions.</p>
              <span>Replies use the same conversation runtime and tenant-bound tools as the dashboard channel.</span>
            </div>
          ) : null}

          {messages.map(message => (
            <article className={`agent-message agent-message--${message.role}`} key={message.id}>
              <span className="agent-message__role">{message.role === 'customer' ? 'Customer' : 'Agent'}</span>
              <p>{message.content}</p>
              {message.result ? (
                <dl className="agent-message__metadata" aria-label="Application result">
                  <div><dt>Intent</dt><dd>{formatMetadata(message.result.detectedIntent)}</dd></div>
                  <div><dt>Language</dt><dd>{formatMetadata(message.result.detectedLanguage)}</dd></div>
                  <div><dt>Handoff</dt><dd>{message.result.needsHuman ? 'Needed' : 'Not needed'}</dd></div>
                  <div><dt>Reason</dt><dd>{formatMetadata(message.result.reasonCode)}</dd></div>
                </dl>
              ) : null}
              {message.diagnostics ? (
                <div className="playground-tools">
                  <dl className="playground-scope" aria-label="Scope decision">
                    <div><dt>Scope</dt><dd>{formatMetadata(message.diagnostics.scope)}</dd></div>
                    <div><dt>Generation</dt><dd>{message.diagnostics.generationBypassed ? 'Bypassed' : 'Model used'}</dd></div>
                    {message.diagnostics.partiallyRelated ? <div><dt>Input</dt><dd>Supported portion only</dd></div> : null}
                  </dl>
                  <span>Tool calls</span>
                  {message.diagnostics.toolCalls.length ? (
                    <ol>
                      {message.diagnostics.toolCalls.map((call, index) => (
                        <li key={`${call.tool}-${index}`}>
                          <code>{call.tool}</code>
                          <span>{formatMetadata(call.outcome)}{call.freshness ? ` · ${formatMetadata(call.freshness)}` : ''}</span>
                        </li>
                      ))}
                    </ol>
                  ) : <p>No business-data tool was used.</p>}
                </div>
              ) : null}
            </article>
          ))}

          {isSending ? (
            <div className="agent-message agent-message--assistant agent-message--pending" role="status">
              <span className="agent-message__role">Agent</span>
              <p>Running the shared agent…</p>
            </div>
          ) : null}
          <div ref={transcriptEnd} />
        </div>

        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

        <form className="agent-composer" onSubmit={handleSubmit}>
          <label htmlFor="playground-message">Customer message</label>
          <textarea
            disabled={isLoading || isSending || isResetting}
            id="playground-message"
            maxLength={4_000}
            onChange={event => setDraft(event.target.value)}
            placeholder="For example: Which automatic cars are available?"
            rows={3}
            value={draft}
          />
          <div className="agent-composer__actions">
            <span>{draft.length.toLocaleString()} / 4,000</span>
            <button disabled={isLoading || isSending || isResetting || !draft.trim()} type="submit">
              {isSending ? 'Sending…' : 'Send message'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export function AiPlaygroundPage() {
  const { selectedBusiness } = useBusiness()
  return selectedBusiness ? <Playground key={selectedBusiness.id} selectedBusiness={selectedBusiness} /> : null
}
