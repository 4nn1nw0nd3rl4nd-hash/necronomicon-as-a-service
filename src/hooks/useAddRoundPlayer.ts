import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

type AddRoundPlayerState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: AddRoundPlayerState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const addPlayerError =
  'Der Spieler konnte nicht hinzugefügt werden. Bitte versuche es erneut.'

export function useAddRoundPlayer() {
  const { session, user } = useAuth()
  const [state, setState] = useState<AddRoundPlayerState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const addPlayer = useCallback(
    async (roundId: string, userId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return false
      }

      if (!roundId.trim() || !userId.trim()) {
        setState({ ...initialState, error: addPlayerError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.rpc('add_player_to_round', {
          p_round_id: roundId,
          p_user_id: userId,
        })

        if (error) {
          setState({ ...initialState, error: addPlayerError })
          return false
        }

        setState({ ...initialState, isSuccess: true })
        return true
      } catch {
        setState({ ...initialState, error: addPlayerError })
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
    addPlayer,
    resetState,
  }
}
