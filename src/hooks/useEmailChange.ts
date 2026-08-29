import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  authErrorMessages,
  getEmailChangeErrorMessage,
} from '../lib/authErrors'
import { supabase } from '../lib/supabase'

export type EmailChangeStatus = 'idle' | 'changed' | 'pending'

type EmailChangeState = {
  isSubmitting: boolean
  error: string | null
  status: EmailChangeStatus
  pendingEmail: string | null
}

const initialState: EmailChangeState = {
  isSubmitting: false,
  error: null,
  status: 'idle',
  pendingEmail: null,
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function emailsMatch(firstEmail: string | undefined, secondEmail: string) {
  return firstEmail?.trim().toLowerCase() === secondEmail.toLowerCase()
}

export function useEmailChange() {
  const { session, user } = useAuth()
  const [state, setState] = useState<EmailChangeState>(initialState)
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

  const changeEmail = useCallback(
    async (
      newEmail: string,
    ): Promise<Exclude<EmailChangeStatus, 'idle'> | null> => {
      if (isRequestInFlightRef.current) {
        return null
      }

      const normalizedEmail = newEmail.trim()
      let validationError: string | null = null

      if (!session || !user) {
        validationError = authErrorMessages.emailChangeSessionMissing
      } else if (!normalizedEmail) {
        validationError = authErrorMessages.emailChangeEmpty
      } else if (
        normalizedEmail.length > 254 ||
        !emailPattern.test(normalizedEmail)
      ) {
        validationError = authErrorMessages.emailChangeInvalid
      } else if (emailsMatch(user.email, normalizedEmail)) {
        validationError = authErrorMessages.emailChangeUnchanged
      }

      if (validationError || !user) {
        setState({
          ...initialState,
          error:
            validationError ??
            authErrorMessages.emailChangeSessionMissing,
        })
        return null
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { data, error } = await supabase.auth.updateUser(
          { email: normalizedEmail },
          {
            emailRedirectTo: `${window.location.origin}/app/profile`,
          },
        )

        if (error) {
          if (isMountedRef.current) {
            setState({
              ...initialState,
              error: getEmailChangeErrorMessage(error),
            })
          }
          return null
        }

        if (emailsMatch(data.user.email, normalizedEmail)) {
          if (isMountedRef.current) {
            setState({ ...initialState, status: 'changed' })
          }
          return 'changed'
        }

        if (emailsMatch(data.user.new_email, normalizedEmail)) {
          if (isMountedRef.current) {
            setState({
              ...initialState,
              status: 'pending',
              pendingEmail: data.user.new_email ?? normalizedEmail,
            })
          }
          return 'pending'
        }

        if (isMountedRef.current) {
          setState({
            ...initialState,
            error: authErrorMessages.unknownEmailChange,
          })
        }
        return null
      } catch {
        if (isMountedRef.current) {
          setState({
            ...initialState,
            error: getEmailChangeErrorMessage(),
          })
        }
        return null
      } finally {
        isRequestInFlightRef.current = false
      }
    },
    [session, user],
  )

  const pendingEmailFromUser = user?.new_email?.trim() || null
  const status = pendingEmailFromUser ? 'pending' : state.status
  const pendingEmail = pendingEmailFromUser ?? state.pendingEmail

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    status,
    pendingEmail,
    changeEmail,
    resetState,
  }
}
