export function StatusMessage({
  children,
  tone = 'neutral',
}: {
  children: string
  tone?: 'neutral' | 'success' | 'error'
}) {
  return (
    <p className={`status-message status-message--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span aria-hidden="true" className="loading-line" />
      <span>{label}</span>
    </div>
  )
}
