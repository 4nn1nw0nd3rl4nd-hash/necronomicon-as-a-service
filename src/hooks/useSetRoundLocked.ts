import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

type SetRoundLockedState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: SetRoundLockedState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const lockError =
  'Der Sperrstatus konnte nicht geändert werden. Bitte versuche es erneut.'

export function useSetRoundLocked() {
  const { session, user } = useAuth()
  const [state, setState] = useState<SetRoundLockedState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const setRoundLocked = useCallback(
    async (
      roundId: string,
      locked: boolean,
      reason?: string,
    ): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return false
      }

      if (!roundId.trim()) {
        setState({ ...initialState, error: lockError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.rpc('set_round_locked', {
          p_round_id: roundId,
          p_locked: locked,
          p_reason: reason?.trim() || null,
        })

        if (error) {
          setState({ ...initialState, error: lockError })
          return false
        }

        setState({ ...initialState, isSuccess: true })
        return true
      } catch {
        setState({ ...initialState, error: lockError })
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
    setRoundLocked,
    resetState,
  }
}
