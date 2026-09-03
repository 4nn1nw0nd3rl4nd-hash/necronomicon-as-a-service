import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

type RecoverOrphanedRoundState = {
  isSubmitting: boolean
  error: string | null
}

const initialState: RecoverOrphanedRoundState = {
  isSubmitting: false,
  error: null,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const recoveryError =
  'Die neue Spielleitung konnte nicht festgelegt werden. Bitte versuche es erneut.'

export function useRecoverOrphanedRound() {
  const { session, user } = useAuth()
  const [state, setState] =
    useState<RecoverOrphanedRoundState>(initialState)
  const isRequestInFlightRef = useRef(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const recover = useCallback(
    async (
      roundId: string,
      newGameMasterUserId: string,
    ): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return false
      }

      if (!roundId.trim() || !newGameMasterUserId.trim()) {
        setState({ ...initialState, error: recoveryError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.rpc('recover_orphaned_round', {
          p_round_id: roundId,
          p_new_game_master_user_id: newGameMasterUserId,
        })

        if (error) {
          if (isMountedRef.current) {
            setState({ ...initialState, error: recoveryError })
          }
          return false
        }

        if (isMountedRef.current) {
          setState(initialState)
        }
        return true
      } catch {
        if (isMountedRef.current) {
          setState({ ...initialState, error: recoveryError })
        }
        return false
      } finally {
        isRequestInFlightRef.current = false

        if (isMountedRef.current) {
          setState((currentState) => ({
            ...currentState,
            isSubmitting: false,
          }))
        }
      }
    },
    [session, user],
  )

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    recover,
    resetState,
  }
}
