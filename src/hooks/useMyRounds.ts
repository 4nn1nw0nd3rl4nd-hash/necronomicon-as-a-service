import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { MyRoundMembership } from '../types/round'

type MyRoundsState = {
  userId: string | undefined
  rounds: MyRoundMembership[]
  isLoading: boolean
  error: string | null
}
const initialState: MyRoundsState = { userId: undefined, rounds: [], isLoading: false, error: null }

export function useMyRounds(userId: string | undefined) {
  const [state, setState] = useState<MyRoundsState>(initialState)
  const reloadRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!userId) return
    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let controller: AbortController | undefined
    const loadRounds = async () => {
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
            .from('round_memberships')
            .select(`
              round_id,
              role,
              created_at,
              round:rounds!inner (
                id,
                name,
                system,
                appointment,
                status,
                locked_at,
                created_at,
                updated_at
              )
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .abortSignal(controller.signal)
            .overrideTypes<MyRoundMembership[], { merge: false }>()
          if (!active) return
          if (error && error.code !== '42501') throw error
          hasLoaded = true
          setState({
            userId, rounds: error ? [] : data ?? [], isLoading: false,
            error: error ? 'Die Runden konnten nicht geladen werden.' : null,
          })
        } catch {
          if (!active) return
          if (!hasLoaded) setState({ ...initialState, userId, error: 'Die Runden konnten nicht geladen werden.' })
        }
      }
      inFlight = false
    }
    reloadRef.current = () => { void loadRounds() }
    void loadRounds()
    return () => {
      active = false
      reloadRef.current = null
      controller?.abort()
    }
  }, [userId])

  const reload = useCallback(() => { reloadRef.current?.() }, [])
  if (!userId) return { ...initialState, reload }
  if (state.userId !== userId) return { ...initialState, isLoading: true, reload }
  return { ...state, reload }
}
