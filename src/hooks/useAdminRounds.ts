import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  AdminRound,
  RoundMemberProfile,
  RoundSummary,
} from '../types/round'

type AdminRoundQueryRow = RoundSummary & {
  orphaned_at: string | null
  round_memberships: Array<{
    user_id: string
    profile: RoundMemberProfile
  }>
}

type AdminRoundsState = {
  userId: string | undefined
  rounds: AdminRound[]
  isLoading: boolean
  error: string | null
}
const initialState: AdminRoundsState = { userId: undefined, rounds: [], isLoading: false, error: null }

export function useAdminRounds(userId: string | undefined) {
  const [state, setState] = useState<AdminRoundsState>(initialState)
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
            .from('rounds')
            .select(`
              id,
              name,
              system,
              appointment,
              status,
              locked_at,
              orphaned_at,
              created_at,
              updated_at,
              round_memberships (
                user_id,
                profile:profiles (
                  id,
                  username,
                  display_name
                )
              )
            `)
            .eq('round_memberships.role', 'game_master')
            .order('created_at', { ascending: false })
            .abortSignal(controller.signal)
            .overrideTypes<AdminRoundQueryRow[], { merge: false }>()
          if (!active) return
          if (error && error.code !== '42501') throw error
          const rounds = (error ? [] : data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            system: row.system,
            appointment: row.appointment,
            status: row.status,
            locked_at: row.locked_at,
            orphaned_at: row.orphaned_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            gameMaster: row.round_memberships[0]?.profile ?? null,
          }))
          hasLoaded = true
          setState({ userId, rounds, isLoading: false, error: error ? 'Die Runden konnten nicht geladen werden.' : null })
        } catch {
          if (!active) return
          if (!hasLoaded) setState({ ...initialState, userId, error: 'Die Runden konnten nicht geladen werden.' })
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
