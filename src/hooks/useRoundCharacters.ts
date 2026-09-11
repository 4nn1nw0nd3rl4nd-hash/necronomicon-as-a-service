import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RoundCharacterSummary } from '../types/character'

type RoundCharactersState = {
  roundId: string | undefined
  accessScope: string | undefined
  characters: RoundCharacterSummary[]
  isLoading: boolean
  error: string | null
}

const initialState: RoundCharactersState = {
  roundId: undefined,
  accessScope: undefined,
  characters: [],
  isLoading: false,
  error: null,
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidRoundId(roundId: string | undefined): roundId is string {
  return Boolean(roundId && uuidPattern.test(roundId))
}

export function useRoundCharacters(
  roundId: string | undefined,
  accessScope?: string,
) {
  const [state, setState] = useState<RoundCharactersState>(initialState)
  const reloadRef = useRef<(() => void) | null>(null)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!hasValidRoundId) return
    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let controller: AbortController | undefined

    const loadRoundCharacters = async () => {
      if (!active) return
      pending = true
      if (inFlight) return
      inFlight = true
      // Keep successful data visible; coalesce invalidations into a trailing fetch.
      while (active && pending) {
        pending = false
        controller = new AbortController()
        if (!hasLoaded) {
          setState({
            roundId,
            accessScope,
            characters: [],
            isLoading: true,
            error: null,
          })
        }
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
            .abortSignal(controller.signal)
            .overrideTypes<RoundCharacterSummary[], { merge: false }>()
          if (!active) return
          if (error && error.code !== '42501') throw error
          hasLoaded = true
          setState({
            roundId,
            accessScope,
            characters: data ?? [],
            isLoading: false,
            error: error?.code === '42501' ? 'Die Charaktere sind nicht verfügbar.' : null,
          })
        } catch {
          if (!active) return
          // Network/server errors do not erase the last successful result.
          if (!hasLoaded) {
            setState({
              roundId,
              accessScope,
              characters: [],
              isLoading: false,
              error: 'Die Charaktere konnten nicht geladen werden.',
            })
          }
        }
      }
      inFlight = false
    }

    reloadRef.current = () => {
      void loadRoundCharacters()
    }
    void loadRoundCharacters()
    return () => {
      active = false
      reloadRef.current = null
      controller?.abort()
    }
  }, [hasValidRoundId, roundId, accessScope])

  const reload = useCallback(() => {
    reloadRef.current?.()
  }, [])

  if (!hasValidRoundId) {
    return {
      characters: [] as RoundCharacterSummary[],
      isLoading: false,
      error: 'Die Charaktere sind nicht verfügbar.',
      reload,
    }
  }

  if (state.roundId !== roundId || state.accessScope !== accessScope) {
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
