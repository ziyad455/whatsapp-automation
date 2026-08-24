import { createAuthClient } from 'better-auth/react'

const serverUrl = (import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4111').replace(/\/$/, '')

export const authClient = createAuthClient({
  baseURL: serverUrl,
  basePath: '/auth/api',
})
