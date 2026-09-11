import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RoundMember } from '../types/round'

type RoundMembersState = {
  roundId: string | undefined
  userId: string | undefined
  members: RoundMember[]
  isLoading: boolean
  error: string | null
}

const initialState: RoundMembersState = {
  roundId: undefined,
  userId: undefined,
  members: [],
  isLoading: false,
  error: null,
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidRoundId(roundId: string | undefined): roundId is string {
  return Boolean(roundId && uuidPattern.test(roundId))
}

export function useRoundMembers(
  roundId: string | undefined,
  userId: string | undefined,
) {
  const [state, setState] = useState<RoundMembersState>(initialState)
  const reloadRef = useRef<(() => void) | null>(null)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!userId || !hasValidRoundId) {
      return
    }

    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let controller: AbortController | undefined

    const loadRoundMembers = async () => {
      if (!active) return
      pending = true
      if (inFlight) return

      inFlight = true
      // Coalesce events during a request into one trailing fetch, never drop them.
      while (active && pending) {
        pending = false
        controller = new AbortController()
        if (!hasLoaded) {
          setState({
            roundId,
            userId,
            members: [],
            isLoading: true,
            error: null,
          })
        }

        try {
          const { data, error } = await supabase
            .from('round_memberships')
            .select(`
              id,
              round_id,
              user_id,
              role,
              active_character_id,
              created_at,
              profile:profiles!inner (
                id,
                username,
                display_name,
                is_superadmin,
                deletion_pending_at
              )
            `)
            .eq('round_id', roundId)
            .order('role', { ascending: true })
            .order('created_at', { ascending: true })
            .abortSignal(controller.signal)
            .overrideTypes<RoundMember[], { merge: false }>()

          if (!active) {
            return
          }

          if (error && error.code !== '42501') {
            throw error
          }

          hasLoaded = true
          setState({
            roundId,
            userId,
            members: data ?? [],
            isLoading: false,
            error: null,
          })
        } catch {
          if (!active) {
            return
          }

          // A failed background refresh must keep the last successful list visible.
          if (!hasLoaded) {
            setState({
              roundId,
              userId,
              members: [],
              isLoading: false,
              error: 'Die Mitglieder konnten nicht geladen werden.',
            })
          }
        }
      }
      inFlight = false
    }

    reloadRef.current = () => {
      void loadRoundMembers()
    }
    void loadRoundMembers()

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
      members: [] as RoundMember[],
      isLoading: false,
      error: null,
      reload,
    }
  }

  if (!hasValidRoundId) {
    return {
      members: [] as RoundMember[],
      isLoading: false,
      error: 'Die Mitglieder sind nicht verfügbar.',
      reload,
    }
  }

  if (state.roundId !== roundId || state.userId !== userId) {
    return {
      members: [] as RoundMember[],
      isLoading: true,
      error: null,
      reload,
    }
  }

  return {
    members: state.members,
    isLoading: state.isLoading,
    error: state.error,
    reload,
  }
}
