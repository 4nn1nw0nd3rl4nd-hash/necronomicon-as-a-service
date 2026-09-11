import { useEffect, useEffectEvent, useId, useRef } from 'react'
import { supabase } from '../lib/supabase'

type RealtimeInvalidationOptions = {
  scopeKey: string | undefined
  table: string
  filter: string
  includeInserts?: boolean
  onInvalidate: () => void
  onSubscribed?: () => void
}

// Reading and request scheduling belong to the data/coordination hooks.
export function useRealtimeInvalidation({
  scopeKey,
  table,
  filter,
  includeInserts = false,
  onInvalidate,
  onSubscribed,
}: RealtimeInvalidationOptions) {
  const instanceId = useId()
  const generation = useRef(0)
  const invalidate = useEffectEvent(onInvalidate)
  const subscribed = useEffectEvent(() => {
    if (onSubscribed) onSubscribed()
    else onInvalidate()
  })

  useEffect(() => {
    if (!scopeKey) return

    let active = true
    // StrictMode can restart the effect before asynchronous channel removal finishes.
    const channelId = ++generation.current
    const notify = () => {
      if (active) invalidate()
    }
    const channel = supabase.channel(
      `invalidation:${instanceId}:${scopeKey}:${channelId}`,
    )
    const events = includeInserts
      ? ['INSERT', 'UPDATE'] as const
      : ['UPDATE'] as const
    for (const event of events) {
      channel.on(
        'postgres_changes',
        { event, schema: 'public', table, filter },
        notify,
      )
    }
    channel.subscribe((status) => {
      // Close the initial fetch/subscribe gap and reconcile after reconnects.
      if (active && status === 'SUBSCRIBED') subscribed()
    })

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [filter, includeInserts, instanceId, scopeKey, table])
}
