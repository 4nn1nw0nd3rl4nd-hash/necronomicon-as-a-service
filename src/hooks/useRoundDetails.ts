import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  RoundDetails,
  RoundDetailsMembership,
  RoundMembershipRole,
} from '../types/round'

type RoundDetailsState = {
  roundId: string | undefined
  userId: string | undefined
  round: RoundDetails | null
  membershipRole: RoundMembershipRole | null
  isLoading: boolean
  error: string | null
}

const initialState: RoundDetailsState = {
  roundId: undefined,
  userId: undefined,
  round: null,
  membershipRole: null,
  isLoading: false,
  error: null,
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidRoundId(roundId: string | undefined): roundId is string {
  return Boolean(roundId && uuidPattern.test(roundId))
}

export function useRoundDetails(
  roundId: string | undefined,
  userId: string | undefined,
) {
  const [state, setState] = useState<RoundDetailsState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!userId || !hasValidRoundId) {
      return
    }

    let isCurrentRequest = true

    const loadRoundDetails = async () => {
      setState({
        roundId,
        userId,
        round: null,
        membershipRole: null,
        isLoading: true,
        error: null,
      })

      try {
        const { data, error } = await supabase
          .from('round_memberships')
          .select(`
            round_id,
            role,
            round:rounds!inner (
              id,
              name,
              system,
              description,
              appointment,
              status,
              created_at,
              updated_at
            )
          `)
          .eq('user_id', userId)
          .eq('round_id', roundId)
          .maybeSingle()
          .overrideTypes<RoundDetailsMembership, { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            roundId,
            userId,
            round: null,
            membershipRole: null,
            isLoading: false,
            error: 'Die Runde konnte nicht geladen werden.',
          })
          return
        }

        if (!data) {
          setState({
            roundId,
            userId,
            round: null,
            membershipRole: null,
            isLoading: false,
            error: 'Die Runde ist nicht verfügbar.',
          })
          return
        }

        setState({
          roundId,
          userId,
          round: data.round,
          membershipRole: data.role,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          roundId,
          userId,
          round: null,
          membershipRole: null,
          isLoading: false,
          error: 'Die Runde konnte nicht geladen werden.',
        })
      }
    }

    void loadRoundDetails()

    return () => {
      isCurrentRequest = false
    }
  }, [hasValidRoundId, reloadKey, roundId, userId])

  const reload = useCallback(() => {
    if (userId && isValidRoundId(roundId)) {
      setReloadKey((currentKey) => currentKey + 1)
    }
  }, [roundId, userId])

  if (!userId) {
    return {
      round: null,
      membershipRole: null,
      isLoading: false,
      error: null,
      reload,
    }
  }

  if (!hasValidRoundId) {
    return {
      round: null,
      membershipRole: null,
      isLoading: false,
      error: 'Die Runde ist nicht verfügbar.',
      reload,
    }
  }

  if (state.roundId !== roundId || state.userId !== userId) {
    return {
      round: null,
      membershipRole: null,
      isLoading: true,
      error: null,
      reload,
    }
  }

  return {
    round: state.round,
    membershipRole: state.membershipRole,
    isLoading: state.isLoading,
    error: state.error,
    reload,
  }
}
