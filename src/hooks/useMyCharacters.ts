import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import type { CharacterSummary } from '../types/character'

type MyCharactersState = {
  userId: string | undefined
  characters: CharacterSummary[]
  isLoading: boolean
  error: string | null
}

const initialState: MyCharactersState = {
  userId: undefined,
  characters: [],
  isLoading: false,
  error: null,
}

export function useMyCharacters() {
  const { user } = useAuth()
  const userId = user?.id
  const [state, setState] = useState<MyCharactersState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!userId) {
      return
    }

    let isCurrentRequest = true

    const loadCharacters = async () => {
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
            owner_user_id,
            round_id,
            template_key,
            template_version,
            created_at,
            updated_at
          `)
          .eq('owner_user_id', userId)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .overrideTypes<CharacterSummary[], { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            userId,
            characters: [],
            isLoading: false,
            error: 'Die Charaktere konnten nicht geladen werden.',
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
          error: 'Die Charaktere konnten nicht geladen werden.',
        })
      }
    }

    void loadCharacters()

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
      characters: [] as CharacterSummary[],
      isLoading: false,
      error: null,
      reload,
    }
  }

  if (state.userId !== userId) {
    return {
      characters: [] as CharacterSummary[],
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
