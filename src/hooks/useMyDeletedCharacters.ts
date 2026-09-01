import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import type { DeletedCharacterSummary } from '../types/character'

type DeletedCharactersState = {
  userId: string | undefined
  characters: DeletedCharacterSummary[]
  isLoading: boolean
  error: string | null
}

const initialState: DeletedCharactersState = {
  userId: undefined,
  characters: [],
  isLoading: false,
  error: null,
}

export function useMyDeletedCharacters() {
  const { user } = useAuth()
  const userId = user?.id
  const [state, setState] = useState<DeletedCharactersState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!userId) {
      return
    }

    let isCurrentRequest = true

    const loadDeletedCharacters = async () => {
      setState({
        userId,
        characters: [],
        isLoading: true,
        error: null,
      })

      try {
        const { data, error } = await supabase
          .from('characters')
          .select(`
            id,
            name,
            round_id,
            template_key,
            template_version,
            deleted_at,
            updated_at
          `)
          .eq('owner_user_id', userId)
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false })
          .overrideTypes<DeletedCharacterSummary[], { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            userId,
            characters: [],
            isLoading: false,
            error: 'Der Papierkorb konnte nicht geladen werden.',
          })
          return
        }

        setState({
          userId,
          characters: data,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          userId,
          characters: [],
          isLoading: false,
          error: 'Der Papierkorb konnte nicht geladen werden.',
        })
      }
    }

    void loadDeletedCharacters()

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
      characters: [] as DeletedCharacterSummary[],
      isLoading: false,
      error: null,
      reload,
    }
  }

  if (state.userId !== userId) {
    return {
      characters: [] as DeletedCharacterSummary[],
      isLoading: true,
      error: null,
      reload,
    }
  }

  return {
    characters: state.characters,
    isLoading: state.isLoading,
    error: state.error,
    reload,
  }
}
