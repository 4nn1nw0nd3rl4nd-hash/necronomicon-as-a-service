import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

type DeleteUserState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: DeleteUserState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const selfDeletionError =
  'Du kannst dein eigenes Konto hier nicht löschen.'
const deletionError =
  'Der Nutzer konnte nicht gelöscht werden. Bitte versuche es erneut.'

export function useDeleteUser() {
  const { session, user } = useAuth()
  const [state, setState] = useState<DeleteUserState>(initialState)
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

  const deleteUser = useCallback(
    async (targetUserId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return false
      }

      if (!targetUserId.trim()) {
        setState({ ...initialState, error: deletionError })
        return false
      }

      if (targetUserId === user.id) {
        setState({ ...initialState, error: selfDeletionError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.functions.invoke(
          'delete-user',
          {
            body: {
              user_id: targetUserId,
            },
          },
        )

        if (error) {
          if (isMountedRef.current) {
            setState({ ...initialState, error: deletionError })
          }
          return false
        }

        if (isMountedRef.current) {
          setState({ ...initialState, isSuccess: true })
        }
        return true
      } catch {
        if (isMountedRef.current) {
          setState({ ...initialState, error: deletionError })
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
    isSuccess: state.isSuccess,
    deleteUser,
    resetState,
  }
}
