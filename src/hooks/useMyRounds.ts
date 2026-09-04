import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { MyRoundMembership } from '../types/round'

type MyRoundsState = {
  userId: string | undefined
  rounds: MyRoundMembership[]
  isLoading: boolean
  error: string | null
}

const initialState: MyRoundsState = {
  userId: undefined,
  rounds: [],
  isLoading: false,
  error: null,
}

export function useMyRounds(userId: string | undefined) {
  const [state, setState] = useState<MyRoundsState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!userId) {
      return
    }

    let isCurrentRequest = true

    const loadRounds = async () => {
      setState({
        userId,
        rounds: [],
        isLoading: true,
        error: null,
      })

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
          .overrideTypes<MyRoundMembership[], { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            userId,
            rounds: [],
            isLoading: false,
            error: 'Die Runden konnten nicht geladen werden.',
          })
          return
        }

        setState({
          userId,
          rounds: data,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          userId,
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
  }, [reloadKey, userId])

  const reload = useCallback(() => {
    if (userId) {
      setReloadKey((currentKey) => currentKey + 1)
    }
  }, [userId])

  if (!userId) {
    return {
      rounds: [] as MyRoundMembership[],
      isLoading: false,
      error: null,
      reload,
    }
  }

  if (state.userId !== userId) {
    return {
      rounds: [] as MyRoundMembership[],
      isLoading: true,
      error: null,
      reload,
    }
  }

  return {
    rounds: state.rounds,
    isLoading: state.isLoading,
    error: state.error,
    reload,
  }
}
