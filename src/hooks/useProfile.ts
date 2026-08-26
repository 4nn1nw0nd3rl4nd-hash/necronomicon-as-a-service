import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/profile'

type ProfileState = {
  userId: string | undefined
  profile: Profile | null
  isLoading: boolean
  error: string | null
  isSaving: boolean
  saveError: string | null
}

const initialState: ProfileState = {
  userId: undefined,
  profile: null,
  isLoading: false,
  error: null,
  isSaving: false,
  saveError: null,
}

export function useProfile(userId: string | undefined) {
  const [state, setState] = useState<ProfileState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)
  const isMountedRef = useRef(true)
  const activeUserIdRef = useRef(userId)

  useEffect(() => {
    activeUserIdRef.current = userId
  }, [userId])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      return
    }

    let isCurrentRequest = true

    const loadProfile = async () => {
      setState({
        userId,
        profile: null,
        isLoading: true,
        error: null,
        isSaving: false,
        saveError: null,
      })

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, username, display_name, role, is_superadmin, created_at, updated_at',
          )
          .eq('id', userId)
          .maybeSingle()
          .overrideTypes<Profile, { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            userId,
            profile: null,
            isLoading: false,
            error: 'Das Profil konnte nicht geladen werden.',
            isSaving: false,
            saveError: null,
          })
          return
        }

        setState({
          userId,
          profile: data,
          isLoading: false,
          error: null,
          isSaving: false,
          saveError: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          userId,
          profile: null,
          isLoading: false,
          error: 'Das Profil konnte nicht geladen werden.',
          isSaving: false,
          saveError: null,
        })
      }
    }

    void loadProfile()

    return () => {
      isCurrentRequest = false
    }
  }, [reloadKey, userId])

  const reload = useCallback(() => {
    if (userId) {
      setReloadKey((currentKey) => currentKey + 1)
    }
  }, [userId])

  const updateDisplayName = useCallback(
    async (displayName: string) => {
      if (!userId) {
        return null
      }

      const normalizedDisplayName = displayName.trim()

      if (!normalizedDisplayName) {
        setState((currentState) =>
          currentState.userId === userId
            ? {
                ...currentState,
                isSaving: false,
                saveError: 'Der Anzeigename darf nicht leer sein.',
              }
            : currentState,
        )
        return null
      }

      setState((currentState) =>
        currentState.userId === userId
          ? {
              ...currentState,
              isSaving: true,
              saveError: null,
            }
          : currentState,
      )

      try {
        const { data, error } = await supabase
          .from('profiles')
          .update({ display_name: normalizedDisplayName })
          .eq('id', userId)
          .select(
            'id, username, display_name, role, is_superadmin, created_at, updated_at',
          )
          .single()
          .overrideTypes<Profile, { merge: false }>()

        if (
          !isMountedRef.current ||
          activeUserIdRef.current !== userId
        ) {
          return null
        }

        if (error) {
          setState((currentState) => ({
            ...currentState,
            isSaving: false,
            saveError:
              'Der Anzeigename konnte nicht gespeichert werden.',
          }))
          return null
        }

        setState({
          userId,
          profile: data,
          isLoading: false,
          error: null,
          isSaving: false,
          saveError: null,
        })

        return data
      } catch {
        if (
          !isMountedRef.current ||
          activeUserIdRef.current !== userId
        ) {
          return null
        }

        setState((currentState) => ({
          ...currentState,
          isSaving: false,
          saveError: 'Der Anzeigename konnte nicht gespeichert werden.',
        }))
        return null
      }
    },
    [userId],
  )

  if (!userId) {
    return {
      profile: null,
      isLoading: false,
      error: null,
      reload,
      updateDisplayName,
      isSaving: false,
      saveError: null,
    }
  }

  if (state.userId !== userId) {
    return {
      profile: null,
      isLoading: true,
      error: null,
      reload,
      updateDisplayName,
      isSaving: false,
      saveError: null,
    }
  }

  return {
    profile: state.profile,
    isLoading: state.isLoading,
    error: state.error,
    reload,
    updateDisplayName,
    isSaving: state.isSaving,
    saveError: state.saveError,
  }
}
