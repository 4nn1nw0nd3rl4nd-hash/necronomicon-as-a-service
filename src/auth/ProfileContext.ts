import { createContext } from 'react'
import type { useOwnProfile } from '../hooks/useOwnProfile'

export type ProfileContextValue = ReturnType<typeof useOwnProfile> & {
  reconnectVersion: number
}
export const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)
