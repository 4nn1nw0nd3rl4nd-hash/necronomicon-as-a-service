import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DeletedRoundPreparedCharacterSummary } from '../types/character'

type DeletedPreparedCharactersState = {
  roundId: string | undefined
  accessScope: string | undefined
  characters: DeletedRoundPreparedCharacterSummary[]
  isLoading: boolean
  error: string | null
}

const initialState: DeletedPreparedCharactersState = {
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

export function useRoundDeletedPreparedCharacters(
  roundId: string | undefined,
  accessScope?: string,
) {
  const [state, setState] =
    useState<DeletedPreparedCharactersState>(initialState)
  const reloadRef = useRef<(() => void) | null>(null)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!hasValidRoundId) return
    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let controller: AbortController | undefined

    const loadDeletedPreparedCharacters = async () => {
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
              deleted_at,
              updated_at
            `)
            .eq('round_id', roundId)
            .is('owner_user_id', null)
            .not('deleted_at', 'is', null)
            .order('deleted_at', { ascending: false })
            .abortSignal(controller.signal)
            .overrideTypes<
              DeletedRoundPreparedCharacterSummary[],
              { merge: false }
            >()
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
              error: 'Der Papierkorb konnte nicht geladen werden.',
            })
          }
        }
      }
      inFlight = false
    }

    reloadRef.current = () => {
      void loadDeletedPreparedCharacters()
    }
    void loadDeletedPreparedCharacters()
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
      characters: [] as DeletedRoundPreparedCharacterSummary[],
      isLoading: false,
      error: null,
      reload,
    }
  }

  if (state.roundId !== roundId || state.accessScope !== accessScope) {
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
