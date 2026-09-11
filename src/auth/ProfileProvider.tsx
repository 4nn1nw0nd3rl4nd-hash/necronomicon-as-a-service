import { useState } from 'react'
import type { PropsWithChildren } from 'react'
import { useAuth } from './useAuth'
import { ProfileContext } from './ProfileContext'
import { useOwnProfile } from '../hooks/useOwnProfile'
import { useFocusReconciliation } from '../hooks/useFocusReconciliation'
import { useRealtimeInvalidation } from '../hooks/useRealtimeInvalidation'

export default function ProfileProvider({ children }: PropsWithChildren) {
  const { user } = useAuth()
  const profile = useOwnProfile(user?.id)
  const [reconnectVersion, setReconnectVersion] = useState(0)
  const reconcile = useFocusReconciliation(user?.id, profile.reload)
  useRealtimeInvalidation({
    scopeKey: user?.id, table: 'profiles', filter: `id=eq.${user?.id}`,
    onInvalidate: reconcile,
    onSubscribed: () => {
      reconcile()
      setReconnectVersion(version => version + 1)
    },
  })
  return (
    <ProfileContext.Provider value={{ ...profile, reconnectVersion }}>
      {children}
    </ProfileContext.Provider>
  )
}
