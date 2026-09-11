import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import { useRealtimeInvalidation } from './useRealtimeInvalidation'

type Source = 'rounds' | 'characters'
type Options = {
  userId: string | undefined
  roundIds: string[]
  reloadRounds: () => void
  reloadCharacters?: () => void
  reloadTrash?: () => void
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function usePersonalOverviewRealtime({
  userId, roundIds, reloadRounds, reloadCharacters, reloadTrash,
}: Options) {
  const hasCharacters = Boolean(reloadCharacters || reloadTrash)
  const scheduleRef = useRef<((source: Source | 'all') => void) | null>(null)
  const flush = useEffectEvent((sources: Set<Source>) => {
    if (sources.has('rounds')) reloadRounds()
    if (sources.has('characters')) {
      reloadCharacters?.()
      reloadTrash?.()
    }
  })
  useEffect(() => {
    if (!userId) return
    const pending = new Set<Source>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (source: Source | 'all') => {
      if (source === 'all') {
        pending.add('rounds')
        if (hasCharacters) pending.add('characters')
      } else pending.add(source)
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        const sources = new Set(pending)
        pending.clear()
        flush(sources)
      }, 100)
    }
    const reconcile = () => {
      if (document.visibilityState === 'visible') schedule('all')
    }
    scheduleRef.current = schedule
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
  }, [userId, hasCharacters])
  const roundsChanged = useCallback(() => scheduleRef.current?.('rounds'), [])
  const charactersChanged = useCallback(() => scheduleRef.current?.('characters'), [])
  const reconcileAll = useCallback(() => scheduleRef.current?.('all'), [])

  useRealtimeInvalidation({
    scopeKey: userId, table: 'round_memberships', filter: `user_id=eq.${userId}`,
    includeInserts: true, onInvalidate: roundsChanged, onSubscribed: reconcileAll,
  })
  useRealtimeInvalidation({
    scopeKey: userId, table: 'rounds',
    filter: [...new Set(roundIds)].filter(id => uuidPattern.test(id)).sort().map(id => `id=eq.${id}`),
    onInvalidate: roundsChanged, onSubscribed: reconcileAll,
  })
  useRealtimeInvalidation({
    scopeKey: hasCharacters ? userId : undefined,
    table: 'characters', filter: `owner_user_id=eq.${userId}`,
    includeInserts: true, onInvalidate: charactersChanged, onSubscribed: reconcileAll,
  })
}
