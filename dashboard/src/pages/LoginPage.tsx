import { type FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authClient } from '../auth/auth-client'

export function LoginPage() {
  const navigate = useNavigate()
  const { data: session, isPending: isSessionPending } = authClient.useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (session) {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate, session])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      const result = await authClient.signIn.email({ email, password })

      if (result.error) {
        setErrorMessage('Unable to sign in. Check your email and password.')
        return
      }

      navigate('/dashboard', { replace: true })
    } catch {
      setErrorMessage('Unable to sign in right now. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSessionPending || session) {
    return <p role="status">Checking your session…</p>
  }

  return (
    <section aria-labelledby="login-title">
      <p className="eyebrow">Account access</p>
      <h1 id="login-title">Sign in</h1>
      <p>Use your account credentials to access the dashboard.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input
          autoComplete="email"
          id="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />

        <label htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />

        {errorMessage ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  )
}
