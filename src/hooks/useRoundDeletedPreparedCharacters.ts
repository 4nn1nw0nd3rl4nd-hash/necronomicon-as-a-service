import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DeletedRoundPreparedCharacterSummary } from '../types/character'

type DeletedPreparedCharactersState = {
  roundId: string | undefined
  characters: DeletedRoundPreparedCharacterSummary[]
  isLoading: boolean
  error: string | null
}

const initialState: DeletedPreparedCharactersState = {
  roundId: undefined,
  characters: [],
  isLoading: false,
  error: null,
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidRoundId(roundId: string | undefined): roundId is string {
  return Boolean(roundId && uuidPattern.test(roundId))
}

export function useRoundDeletedPreparedCharacters(
  roundId: string | undefined,
) {
  const [state, setState] =
    useState<DeletedPreparedCharactersState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!hasValidRoundId) {
      return
    }

    let isCurrentRequest = true

    const loadDeletedPreparedCharacters = async () => {
      setState({
        roundId,
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
            deleted_at,
            updated_at
          `)
          .eq('round_id', roundId)
          .is('owner_user_id', null)
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false })
          .overrideTypes<
            DeletedRoundPreparedCharacterSummary[],
            { merge: false }
          >()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            roundId,
            characters: [],
            isLoading: false,
            error: 'Der Papierkorb konnte nicht geladen werden.',
          })
          return
        }

        setState({
          roundId,
          characters: data,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          roundId,
          characters: [],
          isLoading: false,
          error: 'Der Papierkorb konnte nicht geladen werden.',
        })
      }
    }

    void loadDeletedPreparedCharacters()

    return () => {
      isCurrentRequest = false
    }
  }, [hasValidRoundId, reloadKey, roundId])

  const reload = useCallback(() => {
    if (isValidRoundId(roundId)) {
      setReloadKey((currentKey) => currentKey + 1)
    }
  }, [roundId])

  if (!hasValidRoundId) {
    return {
      characters: [] as DeletedRoundPreparedCharacterSummary[],
      isLoading: false,
      error: null,
      reload,
    }
  }

  if (state.roundId !== roundId) {
    return {
      characters: [] as DeletedRoundPreparedCharacterSummary[],
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
