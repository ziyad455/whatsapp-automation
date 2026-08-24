import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authClient } from '../auth/auth-client'

export function DashboardPage() {
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()
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
    <section aria-labelledby="dashboard-title">
      <p className="eyebrow">Workspace</p>
      <h1 id="dashboard-title">Dashboard</h1>
      {session ? <p>Signed in as {session.user.email}.</p> : null}
      <p>Business operations will appear here as their foundation is implemented.</p>
      <button disabled={isSigningOut} onClick={handleSignOut} type="button">
        {isSigningOut ? 'Signing out…' : 'Sign out'}
      </button>
    </section>
  )
}
