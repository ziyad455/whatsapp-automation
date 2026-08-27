import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { dashboardApi, getErrorMessage } from '../api/client'
import type { BusinessSummary } from '../api/types'
import { BusinessContext, type BusinessContextValue } from './business-context'

const selectedBusinessStorageKey = 'whatsapp-automation:selected-business'

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([])
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let isCurrent = true

    async function loadBusinesses() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await dashboardApi.listBusinesses()

        if (!isCurrent) return

        setBusinesses(response.businesses)
        const storedBusinessId = window.localStorage.getItem(selectedBusinessStorageKey)
        setSelectedBusinessId(
          response.businesses.some((business) => business.id === storedBusinessId)
            ? storedBusinessId
            : null,
        )
      } catch (loadError) {
        if (isCurrent) setError(getErrorMessage(loadError))
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    void loadBusinesses()
    return () => {
      isCurrent = false
    }
  }, [reloadKey])

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) ?? null,
    [businesses, selectedBusinessId],
  )

  const value = useMemo<BusinessContextValue>(
    () => ({
      businesses,
      selectedBusiness,
      isLoading,
      error,
      selectBusiness: (businessId) => {
        if (!businesses.some((business) => business.id === businessId)) return
        window.localStorage.setItem(selectedBusinessStorageKey, businessId)
        setSelectedBusinessId(businessId)
      },
      reload: () => setReloadKey((key) => key + 1),
    }),
    [businesses, error, isLoading, selectedBusiness],
  )

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
}
