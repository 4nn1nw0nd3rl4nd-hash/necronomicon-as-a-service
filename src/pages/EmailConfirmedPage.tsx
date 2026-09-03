import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type ConfirmationStatus = 'processing' | 'success' | 'error'

const confirmationErrorMessage =
  'Der Bestätigungslink konnte nicht verarbeitet werden.'

function EmailConfirmedPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isSignupFlow = searchParams.get('flow') === 'signup'
  const [hasAuthCallbackError] = useState(() => {
    const hashParams = new URLSearchParams(
      window.location.hash.slice(1),
    )

    return (
      hashParams.has('error') ||
      hashParams.has('error_code') ||
      hashParams.has('error_description')
    )
  })
  const signOutResultRef = useRef<Promise<boolean> | null>(null)
  const [status, setStatus] = useState<ConfirmationStatus>(
    isSignupFlow && !hasAuthCallbackError ? 'processing' : 'error',
  )

  useEffect(() => {
    if (!isSignupFlow || hasAuthCallbackError) {
      return
    }

    let isActive = true
    let isSettled = false
    let waitTimeoutId: number | null = null
    let authEventTimeoutId: number | null = null
    let unsubscribe: () => void = () => undefined

    const stopWaiting = () => {
      unsubscribe()
      unsubscribe = () => undefined

      if (waitTimeoutId !== null) {
        window.clearTimeout(waitTimeoutId)
        waitTimeoutId = null
      }

      if (authEventTimeoutId !== null) {
        window.clearTimeout(authEventTimeoutId)
        authEventTimeoutId = null
      }
    }

    const showError = () => {
      if (isSettled) {
        return
      }

      isSettled = true
      stopWaiting()

      if (isActive) {
        setStatus('error')
      }
    }

    const endSignupSession = () => {
      if (isSettled) {
        return
      }

      isSettled = true
      stopWaiting()

      if (!signOutResultRef.current) {
        signOutResultRef.current = supabase.auth
          .signOut({ scope: 'local' })
          .then(({ error }) => error === null)
          .catch(() => false)
      }

      void signOutResultRef.current.then((wasSignedOut) => {
        if (isActive) {
          setStatus(wasSignedOut ? 'success' : 'error')
        }
      })
    }

    if (signOutResultRef.current) {
      endSignupSession()

      return () => {
        isActive = false
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === 'SIGNED_IN' &&
        session &&
        authEventTimeoutId === null
      ) {
        authEventTimeoutId = window.setTimeout(
          endSignupSession,
          0,
        )
      }
    })

    unsubscribe = () => subscription.unsubscribe()

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isActive || isSettled) {
          return
        }

        if (error) {
          showError()
          return
        }

        if (data.session) {
          endSignupSession()
          return
        }

        waitTimeoutId = window.setTimeout(showError, 3_000)
      })
      .catch(showError)

    return () => {
      isActive = false
      stopWaiting()
    }
  }, [hasAuthCallbackError, isSignupFlow])

  const isSuccess = status === 'success'

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="confirmation-title">
        <h1 className="auth-title" id="confirmation-title">
          {isSuccess ? 'E-Mail-Adresse bestätigt' : 'E-Mail-Bestätigung'}
        </h1>
        {status === 'processing' ? (
          <p className="auth-success" role="status">
            Bestätigungslink wird verarbeitet...
          </p>
        ) : (
          <div className="auth-form">
            <p
              className={isSuccess ? 'auth-success' : 'auth-error'}
              role={isSuccess ? 'status' : 'alert'}
            >
              {isSuccess
                ? 'Dein Account ist jetzt bereit. Du kannst dich nun anmelden.'
                : confirmationErrorMessage}
            </p>
            <button
              className="auth-submit"
              type="button"
              onClick={() => navigate('/login')}
            >
              Zum Login
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

export default EmailConfirmedPage
