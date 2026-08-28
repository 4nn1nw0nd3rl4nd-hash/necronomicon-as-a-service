import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  AdminRound,
  RoundMemberProfile,
  RoundSummary,
} from '../types/round'

type AdminRoundQueryRow = RoundSummary & {
  round_memberships: Array<{
    user_id: string
    profile: RoundMemberProfile
  }>
}

type AdminRoundsState = {
  rounds: AdminRound[]
  isLoading: boolean
  error: string | null
}

const initialState: AdminRoundsState = {
  rounds: [],
  isLoading: true,
  error: null,
}

export function useAdminRounds() {
  const [state, setState] = useState<AdminRoundsState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let isCurrentRequest = true

    const loadRounds = async () => {
      setState({
        rounds: [],
        isLoading: true,
        error: null,
      })

      try {
        const { data, error } = await supabase
          .from('rounds')
          .select(`
            id,
            name,
            system,
            appointment,
            status,
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
          .overrideTypes<AdminRoundQueryRow[], { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            rounds: [],
            isLoading: false,
            error: 'Die Runden konnten nicht geladen werden.',
          })
          return
        }

        const rounds = data.map((row) => ({
          id: row.id,
          name: row.name,
          system: row.system,
          appointment: row.appointment,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          gameMaster: row.round_memberships[0]?.profile ?? null,
        }))

        setState({
          rounds,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          rounds: [],
          isLoading: false,
          error: 'Die Runden konnten nicht geladen werden.',
        })
      }
    }

    void loadRounds()

    return () => {
      isCurrentRequest = false
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setReloadKey((currentKey) => currentKey + 1)
  }, [])

  return {
    rounds: state.rounds,
    isLoading: state.isLoading,
    error: state.error,
    reload,
  }
}
