import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type PasswordResetRequestState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: PasswordResetRequestState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const requestError =
  'Der Reset-Link konnte gerade nicht angefordert werden. Bitte versuche es später erneut.'

export function usePasswordResetRequest() {
  const [state, setState] =
    useState<PasswordResetRequestState>(initialState)
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

  const requestPasswordReset = useCallback(
    async (email: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      const normalizedEmail = email.trim()

      if (!normalizedEmail) {
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.auth.resetPasswordForEmail(
          normalizedEmail,
          {
            redirectTo: `${window.location.origin}/reset-password`,
          },
        )

        if (error) {
          if (isMountedRef.current) {
            setState({ ...initialState, error: requestError })
          }
          return false
        }

        if (isMountedRef.current) {
          setState({ ...initialState, isSuccess: true })
        }
        return true
      } catch {
        if (isMountedRef.current) {
          setState({ ...initialState, error: requestError })
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
    [],
  )

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    isSuccess: state.isSuccess,
    requestPasswordReset,
    resetState,
  }
}
