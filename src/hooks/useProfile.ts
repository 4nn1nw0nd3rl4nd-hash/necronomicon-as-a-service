import { useContext } from 'react'
import { ProfileContext } from '../auth/ProfileContext'

export function useProfile(userId: string | undefined) {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('useProfile must be used within ProfileProvider')
  if (!userId || context.userId !== userId) {
    return {
      profile: null, isLoading: Boolean(userId), error: null,
      isSaving: false, saveError: null, reconnectVersion: 0,
      reload: () => {}, updateDisplayName: async () => null,
    }
  }
  return context
}
