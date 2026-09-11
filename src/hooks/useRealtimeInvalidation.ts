import { useEffect, useEffectEvent, useId, useRef } from 'react'
import { supabase } from '../lib/supabase'

type RealtimeInvalidationOptions = {
  scopeKey: string | undefined
  table: string
  filter: string
  onInvalidate: () => void
}

// UPDATE-only invalidation. Reading and request scheduling belong to the data hook.
export function useRealtimeInvalidation({
  scopeKey,
  table,
  filter,
  onInvalidate,
}: RealtimeInvalidationOptions) {
  const instanceId = useId()
  const generation = useRef(0)
  const invalidate = useEffectEvent(onInvalidate)

  useEffect(() => {
    if (!scopeKey) return

    let active = true
    // StrictMode can restart the effect before asynchronous channel removal finishes.
    const channelId = ++generation.current
    const notify = () => {
      if (active) invalidate()
    }
    const channel = supabase
      .channel(`invalidation:${instanceId}:${scopeKey}:${channelId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter },
        notify,
      )
      .subscribe((status) => {
        // Close the initial fetch/subscribe gap and reconcile after reconnects.
        if (status === 'SUBSCRIBED') notify()
      })

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [filter, instanceId, scopeKey, table])
}
