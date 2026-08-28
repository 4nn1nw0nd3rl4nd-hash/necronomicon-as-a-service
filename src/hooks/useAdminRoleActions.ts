import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'

type AdminRoleActionState = {
  isSubmitting: boolean
  activeUserId: string | null
  error: string | null
  successMessage: string | null
}

const initialState: AdminRoleActionState = {
  isSubmitting: false,
  activeUserId: null,
  error: null,
  successMessage: null,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const promoteError =
  'Der Nutzer konnte nicht zum Admin gemacht werden. Bitte versuche es erneut.'
const promoteSuccess = 'Nutzer wurde zum Admin gemacht.'

export function useAdminRoleActions() {
  const { session, user } = useAuth()
  const [state, setState] =
    useState<AdminRoleActionState>(initialState)
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
      activeUserId: currentState.activeUserId,
    }))
  }, [])

  const promoteUser = useCallback(
    async (targetUserId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return false
      }

      if (!targetUserId.trim()) {
        setState({ ...initialState, error: promoteError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({
        ...initialState,
        isSubmitting: true,
        activeUserId: targetUserId,
      })

      try {
        const { error } = await supabase.rpc(
          'promote_user_to_admin',
          {
            p_user_id: targetUserId,
          },
        )

        if (error) {
          if (isMountedRef.current) {
            setState({ ...initialState, error: promoteError })
          }
          return false
        }

        if (isMountedRef.current) {
          setState({
            ...initialState,
            successMessage: promoteSuccess,
          })
        }
        return true
      } catch {
        if (isMountedRef.current) {
          setState({ ...initialState, error: promoteError })
        }
        return false
      } finally {
        isRequestInFlightRef.current = false

        if (isMountedRef.current) {
          setState((currentState) => ({
            ...currentState,
            isSubmitting: false,
            activeUserId: null,
          }))
        }
      }
    },
    [session, user],
  )

  return {
    isSubmitting: state.isSubmitting,
    activeUserId: state.activeUserId,
    error: state.error,
    successMessage: state.successMessage,
    promoteUser,
    resetState,
  }
}
