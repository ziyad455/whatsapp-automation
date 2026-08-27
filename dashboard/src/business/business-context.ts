import { createContext, useContext } from 'react'
import type { BusinessSummary } from '../api/types'

export interface BusinessContextValue {
  businesses: BusinessSummary[]
  selectedBusiness: BusinessSummary | null
  selectBusiness: (businessId: string) => void
  isLoading: boolean
  error: string | null
  reload: () => void
}

export const BusinessContext = createContext<BusinessContextValue | null>(null)

export function useBusiness() {
  const value = useContext(BusinessContext)

  if (!value) throw new Error('useBusiness must be used inside BusinessProvider.')
  return value
}
