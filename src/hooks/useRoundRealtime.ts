import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import { useRealtimeInvalidation } from './useRealtimeInvalidation'

type Source = 'round' | 'members' | 'characters'
type RoundRealtimeOptions = {
  roundId: string | undefined
  userId: string | undefined
  reloadRound: () => void
  reloadMembers: () => void
  reloadCharacters: () => void
  reloadTrash: () => void
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function useRoundRealtime({
  roundId,
  userId,
  reloadRound,
  reloadMembers,
  reloadCharacters,
  reloadTrash,
}: RoundRealtimeOptions) {
  const scopeKey = userId && roundId && uuidPattern.test(roundId)
    ? `${userId}:${roundId}`
    : undefined
  const scheduleRef = useRef<((sources: Source[]) => void) | null>(null)
  const flush = useEffectEvent((sources: Set<Source>) => {
    if (sources.has('round')) reloadRound()
    if (sources.has('members')) reloadMembers()
    if (sources.has('characters')) {
      reloadCharacters()
      reloadTrash()
    }
  })

  useEffect(() => {
    if (!scopeKey) return
    const pending = new Set<Source>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (sources: Source[]) => {
      sources.forEach(source => pending.add(source))
      // One bounded window coalesces RPC event bursts and focus + visibility.
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        const sources = new Set(pending)
        pending.clear()
        flush(sources)
      }, 100)
    }
    scheduleRef.current = schedule
    const reconcile = () => {
      if (document.visibilityState === 'visible') {
        schedule(['round', 'members', 'characters'])
      }
    }
    window.addEventListener('focus', reconcile)
    window.addEventListener('online', reconcile)
    document.addEventListener('visibilitychange', reconcile)
    return () => {
      scheduleRef.current = null
      clearTimeout(timer)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('online', reconcile)
      document.removeEventListener('visibilitychange', reconcile)
    }
  }, [scopeKey])

  const reconcileAll = useCallback(() => {
    // Round locks and memberships affect access to all data in this view.
    scheduleRef.current?.(['round', 'members', 'characters'])
  }, [])
  const charactersChanged = useCallback(() => {
    // Character lifecycle triggers can also update active_character_id.
    scheduleRef.current?.(['members', 'characters'])
  }, [])

  useRealtimeInvalidation({
    scopeKey,
    table: 'rounds',
    filter: `id=eq.${roundId}`,
    onInvalidate: reconcileAll,
    onSubscribed: reconcileAll,
  })
  useRealtimeInvalidation({
    scopeKey,
    table: 'round_memberships',
    filter: `round_id=eq.${roundId}`,
    includeInserts: true,
    onInvalidate: reconcileAll,
    onSubscribed: reconcileAll,
  })
  useRealtimeInvalidation({
    scopeKey,
    table: 'characters',
    filter: `round_id=eq.${roundId}`,
    includeInserts: true,
    onInvalidate: charactersChanged,
    onSubscribed: reconcileAll,
  })
}
