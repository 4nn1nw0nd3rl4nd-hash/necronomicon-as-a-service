import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/profile'

type AdminUsersState = {
  userId: string | undefined
  users: Profile[]
  isLoading: boolean
  error: string | null
}
const initialState: AdminUsersState = { userId: undefined, users: [], isLoading: false, error: null }

export function useAdminUsers(userId: string | undefined) {
  const [state, setState] = useState<AdminUsersState>(initialState)
  const reloadRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!userId) return
    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let controller: AbortController | undefined
    const load = async () => {
      if (!active) return
      pending = true
      if (inFlight) return
      inFlight = true
      while (active && pending) {
        pending = false
        controller = new AbortController()
        if (!hasLoaded) setState({ ...initialState, userId, isLoading: true })
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select(
              'id, username, display_name, role, is_superadmin, deletion_pending_at, created_at, updated_at',
            )
            .order('is_superadmin', { ascending: false })
            .order('username', { ascending: true })
            .abortSignal(controller.signal)
            .overrideTypes<Profile[], { merge: false }>()
          if (!active) return
          if (error && error.code !== '42501') throw error
          hasLoaded = true
          setState({ userId, users: error ? [] : data ?? [], isLoading: false, error: error ? 'Die Nutzer konnten nicht geladen werden.' : null })
        } catch {
          if (!active) return
          if (!hasLoaded) setState({ ...initialState, userId, error: 'Die Nutzer konnten nicht geladen werden.' })
        }
      }
      inFlight = false
    }
    reloadRef.current = () => { void load() }
    void load()
    return () => {
      active = false
      reloadRef.current = null
      controller?.abort()
    }
  }, [userId])
  const reload = useCallback(() => reloadRef.current?.(), [])
  if (!userId) return { ...initialState, reload }
  if (state.userId !== userId) return { ...initialState, isLoading: true, reload }
  return { ...state, reload }
}
