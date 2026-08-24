import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title">
      <p className="eyebrow">404</p>
      <h1 id="not-found-title">Page not found</h1>
      <p>The requested dashboard page does not exist.</p>
      <Link className="primary-link" to="/login">
        Return to login
      </Link>
    </section>
  )
}
