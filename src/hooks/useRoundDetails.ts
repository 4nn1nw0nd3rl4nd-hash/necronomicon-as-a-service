import { useCallback, useEffect, useRef, useState } from 'react'
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
  const reloadRef = useRef<(() => void) | null>(null)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!userId || !hasValidRoundId) return
    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let controller: AbortController | undefined

    const loadRoundDetails = async () => {
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
            userId,
            round: null,
            membershipRole: null,
            isLoading: true,
            error: null,
          })
        }
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
                locked_at,
                locked_reason,
                orphaned_at,
                created_at,
                updated_at
              )
            `)
            .eq('user_id', userId)
            .eq('round_id', roundId)
            .abortSignal(controller.signal)
            .maybeSingle()
            .overrideTypes<RoundDetailsMembership, { merge: false }>()
          if (!active) return
          if (error && error.code !== '42501') throw error
          hasLoaded = true
          if (!data) {
            setState({
              roundId,
              userId,
              round: null,
              membershipRole: null,
              isLoading: false,
              error: 'Die Runde ist nicht verfügbar.',
            })
          } else {
            setState({
              roundId,
              userId,
              round: data.round,
              membershipRole: data.role,
              isLoading: false,
              error: null,
            })
          }
        } catch {
          if (!active) return
          // Network/server errors do not erase the last successful result.
          if (!hasLoaded) {
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
      }
      inFlight = false
    }

    reloadRef.current = () => {
      void loadRoundDetails()
    }
    void loadRoundDetails()
    return () => {
      active = false
      reloadRef.current = null
      controller?.abort()
    }
  }, [hasValidRoundId, roundId, userId])

  const reload = useCallback(() => {
    reloadRef.current?.()
  }, [])

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
