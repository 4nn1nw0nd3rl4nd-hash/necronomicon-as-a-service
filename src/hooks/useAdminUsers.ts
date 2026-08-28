import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/profile'

type AdminUsersState = {
  users: Profile[]
  isLoading: boolean
  error: string | null
}

const initialState: AdminUsersState = {
  users: [],
  isLoading: true,
  error: null,
}

export function useAdminUsers() {
  const [state, setState] = useState<AdminUsersState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let isCurrentRequest = true

    const loadUsers = async () => {
      setState({
        users: [],
        isLoading: true,
        error: null,
      })

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, username, display_name, role, is_superadmin, created_at, updated_at',
          )
          .order('is_superadmin', { ascending: false })
          .order('username', { ascending: true })
          .overrideTypes<Profile[], { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            users: [],
            isLoading: false,
            error: 'Die Nutzer konnten nicht geladen werden.',
          })
          return
        }

        setState({
          users: data,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          users: [],
          isLoading: false,
          error: 'Die Nutzer konnten nicht geladen werden.',
        })
      }
    }

    void loadUsers()

    return () => {
      isCurrentRequest = false
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setReloadKey((currentKey) => currentKey + 1)
  }, [])

  return {
    users: state.users,
    isLoading: state.isLoading,
    error: state.error,
    reload,
  }
}
