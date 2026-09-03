import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RecoveryCandidateProfile } from '../types/round'

type ProfileSearchState = {
  result: RecoveryCandidateProfile | null
  isSearching: boolean
  error: string | null
}

const initialState: ProfileSearchState = {
  result: null,
  isSearching: false,
  error: null,
}

const emptyUsernameError = 'Bitte gib einen Benutzernamen ein.'
const notFoundError = 'Kein Nutzer mit diesem Benutzernamen gefunden.'
const searchError =
  'Der Nutzer konnte nicht gesucht werden. Bitte versuche es erneut.'

function escapeIlikePattern(username: string) {
  return username
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

export function useProfileSearch() {
  const [state, setState] = useState<ProfileSearchState>(initialState)
  const isRequestInFlightRef = useRef(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  const resetSearch = useCallback(() => {
    setState((currentState) => ({
      ...currentState,
      result: null,
      error: null,
    }))
  }, [])

  const searchByUsername = useCallback(
    async (username: string): Promise<RecoveryCandidateProfile | null> => {
      if (isRequestInFlightRef.current) {
        return null
      }

      const normalizedUsername = username.trim()

      if (!normalizedUsername) {
        setState({ ...initialState, error: emptyUsernameError })
        return null
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSearching: true })

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, username, display_name, is_superadmin, deletion_pending_at',
          )
          .ilike('username', escapeIlikePattern(normalizedUsername))
          .maybeSingle()
          .overrideTypes<RecoveryCandidateProfile, { merge: false }>()

        if (!isMountedRef.current) {
          return null
        }

        if (error) {
          setState({ ...initialState, error: searchError })
          return null
        }

        if (!data) {
          setState({ ...initialState, error: notFoundError })
          return null
        }

        setState({ ...initialState, result: data })
        return data
      } catch {
        if (isMountedRef.current) {
          setState({ ...initialState, error: searchError })
        }

        return null
      } finally {
        isRequestInFlightRef.current = false

        if (isMountedRef.current) {
          setState((currentState) => ({
            ...currentState,
            isSearching: false,
          }))
        }
      }
    },
    [],
  )

  return {
    result: state.result,
    isSearching: state.isSearching,
    error: state.error,
    searchByUsername,
    resetSearch,
  }
}
