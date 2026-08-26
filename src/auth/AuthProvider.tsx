import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext } from './AuthContext'

function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    let hasAuthStateChanged = false

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return
      }

      hasAuthStateChanged = true
      setSession(nextSession)
      setIsLoading(false)
    })

    const loadInitialSession = async () => {
      const {
        data: { session: initialSession },
      } = await supabase.auth.getSession()

      if (!isMounted) {
        return
      }

      if (!hasAuthStateChanged) {
        setSession(initialSession)
      }

      setIsLoading(false)
    }

    void loadInitialSession()

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const user = session?.user ?? null

  return (
    <AuthContext.Provider value={{ session, user, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export default AuthProvider
