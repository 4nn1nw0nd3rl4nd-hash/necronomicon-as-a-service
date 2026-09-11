import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminRoundDetails } from '../types/round'

type AdminRoundDetailsState = {
  userId: string | undefined
  roundId: string | undefined
  round: AdminRoundDetails | null
  isLoading: boolean
  error: string | null
}
const initialState: AdminRoundDetailsState = { userId: undefined, roundId: undefined, round: null, isLoading: false, error: null }

export function useAdminRoundDetails(roundId: string | undefined, userId: string | undefined) {
  const [state, setState] = useState<AdminRoundDetailsState>(initialState)
  const reloadRef = useRef<(() => void) | null>(null)
  const hasValidRoundId = Boolean(roundId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roundId))

  useEffect(() => {
    if (!userId || !hasValidRoundId) return
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
        if (!hasLoaded) setState({ ...initialState, roundId, userId, isLoading: true })
        try {
          const { data, error } = await supabase
            .from('rounds')
            .select(
              'id, name, system, description, appointment, status, locked_at, locked_reason, orphaned_at, created_at, updated_at',
            )
            .eq('id', roundId)
            .abortSignal(controller.signal)
            .maybeSingle()
            .overrideTypes<AdminRoundDetails, { merge: false }>()
          if (!active) return
          if (error && error.code !== '42501') throw error
          hasLoaded = true
          setState({ roundId, userId, round: error ? null : data, isLoading: false, error: error || !data ? 'Die Runde ist nicht verfügbar.' : null })
        } catch {
          if (!active) return
          if (!hasLoaded) setState({ ...initialState, roundId, userId, error: 'Die Runde konnte nicht geladen werden.' })
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
  }, [userId, roundId, hasValidRoundId])
  const reload = useCallback(() => reloadRef.current?.(), [])
  if (!userId || !hasValidRoundId) return { ...initialState, reload }
  if (state.userId !== userId || state.roundId !== roundId) return { ...initialState, isLoading: true, reload }
  return { ...state, reload }
}
