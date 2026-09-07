import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { authClient } from '../auth/auth-client'
import { BusinessProvider } from '../business/BusinessContext'
import { useBusiness } from '../business/business-context'
import { LoadingBlock, StatusMessage } from '../components/StatusMessage'

const navigation = [
  { to: '/dashboard/profile', label: 'Business profile' },
  { to: '/dashboard/hours', label: 'Opening hours' },
  { to: '/dashboard/rules', label: 'Business rules' },
  { to: '/dashboard/data', label: 'Business data' },
  { to: '/dashboard/understanding', label: 'Understanding preview' },
  { to: '/dashboard/agent-chat', label: 'Agent chat' },
  ...(import.meta.env.DEV ? [{ to: '/dashboard/ai-playground', label: 'AI playground' }] : []),
]

function DashboardFrame() {
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()
  const { businesses, selectedBusiness, selectBusiness, isLoading, error, reload } = useBusiness()
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)

    try {
      await authClient.signOut()
      navigate('/login', { replace: true })
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <span className="dashboard-brand__mark" aria-hidden="true">WA</span>
          <div>
            <strong>WhatsApp Automation</strong>
            <span>Operate</span>
          </div>
        </div>

        <nav className="dashboard-nav" aria-label="Dashboard navigation">
          <p className="dashboard-nav__label">Configure</p>
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="dashboard-account">
          <span>{session?.user.email}</span>
          <button className="text-button" disabled={isSigningOut} onClick={handleSignOut} type="button">
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>

      <div className="dashboard-workspace">
        <header className="workspace-header">
          <div>
            <span className="workspace-header__label">Active business</span>
            <select
              aria-label="Active business"
              onChange={(event) => selectBusiness(event.target.value)}
              value={selectedBusiness?.id ?? ''}
            >
              <option value="" disabled>Select a business</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </div>
          {selectedBusiness ? (
            <span className="role-badge">{selectedBusiness.role.toLowerCase()}</span>
          ) : null}
        </header>

        <main className="workspace-main">
          {isLoading ? <LoadingBlock label="Loading your businesses…" /> : null}
          {!isLoading && error ? (
            <div className="empty-state">
              <StatusMessage tone="error">{error}</StatusMessage>
              <button onClick={reload} type="button">Try again</button>
            </div>
          ) : null}
          {!isLoading && !error && businesses.length === 0 ? (
            <div className="empty-state">
              <p className="eyebrow">Workspace unavailable</p>
              <h1>No business access</h1>
              <p>Your account is not currently connected to a business.</p>
            </div>
          ) : null}
          {!isLoading && !error && businesses.length > 0 && !selectedBusiness ? (
            <div className="empty-state">
              <p className="eyebrow">Choose a workspace</p>
              <h1>Select a business to continue</h1>
              <p>The selection above determines which business data you can view and edit.</p>
            </div>
          ) : null}
          {selectedBusiness ? <Outlet key={selectedBusiness.id} /> : null}
        </main>
      </div>
    </div>
  )
}

export function DashboardLayout() {
  return (
    <BusinessProvider>
      <DashboardFrame />
    </BusinessProvider>
  )
}
