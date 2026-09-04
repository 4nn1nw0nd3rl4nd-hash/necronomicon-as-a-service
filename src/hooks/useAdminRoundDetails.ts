import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminRoundDetails } from '../types/round'

type AdminRoundDetailsState = {
  roundId: string | undefined
  round: AdminRoundDetails | null
  isLoading: boolean
  error: string | null
}

const initialState: AdminRoundDetailsState = {
  roundId: undefined,
  round: null,
  isLoading: false,
  error: null,
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidRoundId(roundId: string | undefined): roundId is string {
  return Boolean(roundId && uuidPattern.test(roundId))
}

export function useAdminRoundDetails(roundId: string | undefined) {
  const [state, setState] =
    useState<AdminRoundDetailsState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!hasValidRoundId) {
      return
    }

    let isCurrentRequest = true

    const loadRoundDetails = async () => {
      setState({
        roundId,
        round: null,
        isLoading: true,
        error: null,
      })

      try {
        const { data, error } = await supabase
          .from('rounds')
          .select(
            'id, name, system, description, appointment, status, locked_at, locked_reason, orphaned_at, created_at, updated_at',
          )
          .eq('id', roundId)
          .maybeSingle()
          .overrideTypes<AdminRoundDetails, { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            roundId,
            round: null,
            isLoading: false,
            error: 'Die Runde konnte nicht geladen werden.',
          })
          return
        }

        if (!data) {
          setState({
            roundId,
            round: null,
            isLoading: false,
            error: 'Die Runde ist nicht verfügbar.',
          })
          return
        }

        setState({
          roundId,
          round: data,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          roundId,
          round: null,
          isLoading: false,
          error: 'Die Runde konnte nicht geladen werden.',
        })
      }
    }

    void loadRoundDetails()

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
      round: null,
      isLoading: false,
      error: 'Die Runde ist nicht verfügbar.',
      reload,
    }
  }

  if (state.roundId !== roundId) {
    return {
      round: null,
      isLoading: true,
      error: null,
      reload,
    }
  }

  return {
    round: state.round,
    isLoading: state.isLoading,
    error: state.error,
    reload,
  }
}
