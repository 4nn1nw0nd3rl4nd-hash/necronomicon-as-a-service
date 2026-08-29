import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { authErrorMessages } from '../lib/authErrors'
import { isPasswordValid } from '../lib/passwordValidation'
import { supabase } from '../lib/supabase'

type PasswordResetState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: PasswordResetState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const invalidRecoveryError =
  'Dieser Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen.'
const resetError =
  'Das Passwort konnte nicht gespeichert werden. Bitte versuche es erneut.'

export function usePasswordReset() {
  const { session, user, isPasswordRecovery } = useAuth()
  const [state, setState] = useState<PasswordResetState>(initialState)
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

  const resetPassword = useCallback(
    async (
      newPassword: string,
      passwordConfirmation: string,
    ): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      let validationError: string | null = null

      if (!isPasswordRecovery || !session || !user) {
        validationError = invalidRecoveryError
      } else if (!newPassword) {
        validationError = 'Bitte gib ein neues Passwort ein.'
      } else if (!passwordConfirmation) {
        validationError = 'Bitte wiederhole das neue Passwort.'
      } else if (!isPasswordValid(newPassword)) {
        validationError = authErrorMessages.invalidPassword
      } else if (newPassword !== passwordConfirmation) {
        validationError = 'Die Passwörter stimmen nicht überein.'
      }

      if (validationError) {
        setState({ ...initialState, error: validationError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.auth.updateUser({
          password: newPassword,
        })

        if (error) {
          if (isMountedRef.current) {
            setState({ ...initialState, error: resetError })
          }
          return false
        }

        await supabase.auth.signOut({ scope: 'local' })

        if (isMountedRef.current) {
          setState({ ...initialState, isSuccess: true })
        }
        return true
      } catch {
        if (isMountedRef.current) {
          setState({ ...initialState, error: resetError })
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
    [isPasswordRecovery, session, user],
  )

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    isSuccess: state.isSuccess,
    resetPassword,
    resetState,
  }
}
