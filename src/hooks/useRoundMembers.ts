import { useCallback, useEffect, useState } from 'react'
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
  const [reloadKey, setReloadKey] = useState(0)
  const hasValidRoundId = isValidRoundId(roundId)

  useEffect(() => {
    if (!userId || !hasValidRoundId) {
      return
    }

    let isCurrentRequest = true

    const loadRoundMembers = async () => {
      setState({
        roundId,
        userId,
        members: [],
        isLoading: true,
        error: null,
      })

      try {
        const { data, error } = await supabase
          .from('round_memberships')
          .select(`
            id,
            round_id,
            user_id,
            role,
            created_at,
            profile:profiles!inner (
              id,
              username,
              display_name
            )
          `)
          .eq('round_id', roundId)
          .order('role', { ascending: true })
          .order('created_at', { ascending: true })
          .overrideTypes<RoundMember[], { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            roundId,
            userId,
            members: [],
            isLoading: false,
            error: 'Die Mitglieder konnten nicht geladen werden.',
          })
          return
        }

        setState({
          roundId,
          userId,
          members: data,
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
          members: [],
          isLoading: false,
          error: 'Die Mitglieder konnten nicht geladen werden.',
        })
      }
    }

    void loadRoundMembers()

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
