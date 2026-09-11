import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import { useRealtimeInvalidation } from './useRealtimeInvalidation'

type Options = {
  characterId: string | undefined
  userId: string | undefined
  roundId: string | null | undefined
  reload: () => void
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function useCharacterRealtime({ characterId, userId, roundId, reload }: Options) {
  const scopeKey = userId && characterId && uuidPattern.test(characterId)
    ? `${userId}:${characterId}` : undefined
  const roundScope = scopeKey && roundId && uuidPattern.test(roundId)
    ? `${scopeKey}:${roundId}` : undefined
  const refresh = useEffectEvent(reload)
  const scheduleRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!scopeKey) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        refresh()
      }, 100)
    }
    const reconcile = () => {
      if (document.visibilityState === 'visible') schedule()
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
  }, [scopeKey])
  const invalidate = useCallback(() => scheduleRef.current?.(), [])

  useRealtimeInvalidation({
    scopeKey, table: 'characters', filter: `id=eq.${characterId}`, onInvalidate: invalidate,
  })
  // Lock and GM changes affect the joined round and character access, without
  // necessarily updating characters. The SELECT remains the authority.
  useRealtimeInvalidation({
    scopeKey: roundScope, table: 'rounds', filter: `id=eq.${roundId}`, onInvalidate: invalidate,
  })
  useRealtimeInvalidation({
    scopeKey: roundScope, table: 'round_memberships', filter: `round_id=eq.${roundId}`,
    includeInserts: true, onInvalidate: invalidate,
  })
}
