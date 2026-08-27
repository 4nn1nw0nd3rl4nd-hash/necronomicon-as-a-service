import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  authErrorMessages,
  getPasswordChangeErrorMessage,
} from '../lib/authErrors'
import { isPasswordValid } from '../lib/passwordValidation'
import { supabase } from '../lib/supabase'

type PasswordChangeState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: PasswordChangeState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

export function usePasswordChange() {
  const { session, user } = useAuth()
  const [state, setState] = useState<PasswordChangeState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      confirmPassword: string,
    ): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      let validationError: string | null = null

      if (!session || !user) {
        validationError = authErrorMessages.passwordChangeSessionMissing
      } else if (!currentPassword) {
        validationError = authErrorMessages.currentPasswordRequired
      } else if (!newPassword) {
        validationError = 'Bitte gib ein neues Passwort ein.'
      } else if (!confirmPassword) {
        validationError = 'Bitte bestätige dein neues Passwort.'
      } else if (!isPasswordValid(newPassword)) {
        validationError = authErrorMessages.invalidPassword
      } else if (newPassword !== confirmPassword) {
        validationError = 'Die Passwörter stimmen nicht überein.'
      } else if (newPassword === currentPassword) {
        validationError = authErrorMessages.samePassword
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
          current_password: currentPassword,
        })

        if (error) {
          setState({
            ...initialState,
            error: getPasswordChangeErrorMessage(error),
          })
          return false
        }

        setState({ ...initialState, isSuccess: true })
        return true
      } catch {
        setState({
          ...initialState,
          error: getPasswordChangeErrorMessage(),
        })
        return false
      } finally {
        isRequestInFlightRef.current = false
      }
    },
    [session, user],
  )

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    isSuccess: state.isSuccess,
    changePassword,
    resetState,
  }
}
