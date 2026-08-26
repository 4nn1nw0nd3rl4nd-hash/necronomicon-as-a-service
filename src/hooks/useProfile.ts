import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/profile'

type ProfileState = {
  userId: string | undefined
  profile: Profile | null
  isLoading: boolean
  error: string | null
}

const initialState: ProfileState = {
  userId: undefined,
  profile: null,
  isLoading: false,
  error: null,
}

export function useProfile(userId: string | undefined) {
  const [state, setState] = useState<ProfileState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)

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
          })
          return
        }

        setState({
          userId,
          profile: data,
          isLoading: false,
          error: null,
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

  if (!userId) {
    return {
      profile: null,
      isLoading: false,
      error: null,
      reload,
    }
  }

  if (state.userId !== userId) {
    return {
      profile: null,
      isLoading: true,
      error: null,
      reload,
    }
  }

  return {
    profile: state.profile,
    isLoading: state.isLoading,
    error: state.error,
    reload,
  }
}
