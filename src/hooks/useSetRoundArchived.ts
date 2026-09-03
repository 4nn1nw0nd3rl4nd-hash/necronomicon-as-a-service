import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

type SetRoundArchivedState = {
  isSubmitting: boolean
  error: string | null
}

const initialState: SetRoundArchivedState = {
  isSubmitting: false,
  error: null,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const archiveError =
  'Der Archivstatus konnte nicht geändert werden. Bitte versuche es erneut.'

export function useSetRoundArchived() {
  const { session, user } = useAuth()
  const [state, setState] = useState<SetRoundArchivedState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const setRoundArchived = useCallback(
    async (roundId: string, archived: boolean): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return false
      }

      if (!roundId.trim()) {
        setState({ ...initialState, error: archiveError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.rpc('set_round_archived', {
          p_round_id: roundId,
          p_archived: archived,
        })

        if (error) {
          setState({ ...initialState, error: archiveError })
          return false
        }

        setState(initialState)
        return true
      } catch {
        setState({ ...initialState, error: archiveError })
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
    setRoundArchived,
    resetState,
  }
}
