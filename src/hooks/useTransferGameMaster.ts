import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

type TransferGameMasterState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: TransferGameMasterState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const transferError =
  'Die Spielleitung konnte nicht übertragen werden. Bitte versuche es erneut.'

export function useTransferGameMaster() {
  const { session, user } = useAuth()
  const [state, setState] = useState<TransferGameMasterState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const transferGameMaster = useCallback(
    async (
      roundId: string,
      newGameMasterId: string,
    ): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return false
      }

      if (!roundId.trim() || !newGameMasterId.trim()) {
        setState({ ...initialState, error: transferError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.rpc('transfer_game_master', {
          p_round_id: roundId,
          p_new_game_master_id: newGameMasterId,
        })

        if (error) {
          setState({ ...initialState, error: transferError })
          return false
        }

        setState({ ...initialState, isSuccess: true })
        return true
      } catch {
        setState({ ...initialState, error: transferError })
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
    transferGameMaster,
    resetState,
  }
}
