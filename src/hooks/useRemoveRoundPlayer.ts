import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

type RemoveRoundPlayerState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: RemoveRoundPlayerState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const removePlayerError =
  'Der Spieler konnte nicht entfernt werden. Bitte versuche es erneut.'

export function useRemoveRoundPlayer() {
  const { session, user } = useAuth()
  const [state, setState] = useState<RemoveRoundPlayerState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const removePlayer = useCallback(
    async (roundId: string, userId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return false
      }

      if (!roundId.trim() || !userId.trim()) {
        setState({ ...initialState, error: removePlayerError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.rpc(
          'remove_player_from_round',
          {
            p_round_id: roundId,
            p_user_id: userId,
          },
        )

        if (error) {
          setState({ ...initialState, error: removePlayerError })
          return false
        }

        setState({ ...initialState, isSuccess: true })
        return true
      } catch {
        setState({ ...initialState, error: removePlayerError })
        return false
      } finally {
        isRequestInFlightRef.current = false
        setState((currentState) => ({
          ...currentState,
          isSubmitting: false,
        }))
      }
    },
    [session, user],
  )

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    isSuccess: state.isSuccess,
    removePlayer,
    resetState,
  }
}
