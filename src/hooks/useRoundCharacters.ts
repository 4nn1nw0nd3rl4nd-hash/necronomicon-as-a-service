import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RoundCharacterSummary } from '../types/character'

type RoundCharactersState = {
  roundId: string | undefined
  characters: RoundCharacterSummary[]
  isLoading: boolean
  error: string | null
}

const initialState: RoundCharactersState = {
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

export function useRoundCharacters(roundId: string | undefined) {
  const [state, setState] = useState<RoundCharactersState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!hasValidRoundId) {
      return
    }

    let isCurrentRequest = true

    const loadRoundCharacters = async () => {
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
            updated_at
          `)
          .eq('round_id', roundId)
          .is('deleted_at', null)
          .order('name', { ascending: true })
          .overrideTypes<RoundCharacterSummary[], { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            roundId,
            characters: [],
            isLoading: false,
            error: 'Die Charaktere konnten nicht geladen werden.',
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
          error: 'Die Charaktere konnten nicht geladen werden.',
        })
      }
    }

    void loadRoundCharacters()

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
      characters: [] as RoundCharacterSummary[],
      isLoading: false,
      error: 'Die Charaktere sind nicht verfügbar.',
      reload,
    }
  }

  if (state.roundId !== roundId) {
    return {
      characters: [] as RoundCharacterSummary[],
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
