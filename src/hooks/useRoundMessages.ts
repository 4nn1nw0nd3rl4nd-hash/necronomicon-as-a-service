import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusReconciliation } from './useFocusReconciliation'
import { useRealtimeInvalidation } from './useRealtimeInvalidation'
import { ROUND_MESSAGE_PAGE_SIZE, roundMessageFields } from '../types/roundMessage'
import type { RoundMessage } from '../types/roundMessage'

type MessagesState = {
  scopeKey: string | undefined
  messages: RoundMessage[]
  isLoading: boolean
  isLoadingOlder: boolean
  hasOlder: boolean
  accessDenied: boolean
  error: string | null
  initialLatestSeq: number | null
}
const emptyState: MessagesState = {
  scopeKey: undefined, messages: [], isLoading: false, isLoadingOlder: false,
  hasOlder: false, accessDenied: false, error: null, initialLatestSeq: null,
}

export function useRoundMessages(roundId: string | undefined, userId: string | undefined) {
  const scopeKey = userId && roundId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roundId)
    ? `${userId}:${roundId}` : undefined
  const [state, setState] = useState<MessagesState>(emptyState)
  const actionsRef = useRef<{ reload: () => void; loadOlder: () => void } | null>(null)

  useEffect(() => {
    if (!scopeKey || !roundId) return
    let active = true, syncing = false, pending = false, initialized = false
    let cursor = 0, accessGeneration = 0
    const rows = new Map<string, RoundMessage>()
    const controllers = new Set<AbortController>()
    let current: MessagesState = { ...emptyState, scopeKey, isLoading: true }
    const publish = (patch: Partial<MessagesState> = {}) => {
      if (!active) return
      current = { ...current, ...patch, messages: [...rows.values()].sort((a, b) => a.round_seq - b.round_seq) }
      setState(current)
    }
    const deny = () => {
      accessGeneration++
      rows.clear()
      cursor = 0
      initialized = false
      publish({ accessDenied: true, isLoading: false, hasOlder: false, initialLatestSeq: null, error: 'Der Chat ist nicht verfügbar.' })
    }
    const read = async (direction: 'initial' | 'newer' | 'older', boundary: number) => {
      const controller = new AbortController()
      controllers.add(controller)
      const generation = accessGeneration
      try {
        // An empty RLS-filtered delta alone cannot signal revoked membership.
        const access = await supabase.rpc('can_read_round_messages', { p_round_id: roundId }).abortSignal(controller.signal)
        if (!active || generation !== accessGeneration) return
        if (access.error) throw access.error
        if (access.data !== true) { deny(); return }
        let query = supabase.from('round_messages').select(roundMessageFields).eq('round_id', roundId)
        if (direction === 'newer') query = query.gt('round_seq', boundary)
        if (direction === 'older') query = query.lt('round_seq', boundary)
        const result = await query.order('round_seq', { ascending: direction === 'newer' })
          .limit(ROUND_MESSAGE_PAGE_SIZE).abortSignal(controller.signal)
          .overrideTypes<RoundMessage[], { merge: false }>()
        if (!active || generation !== accessGeneration) return
        if (result.error) throw result.error
        return { batch: result.data ?? [], generation }
      } catch (error) {
        if (!active || generation !== accessGeneration) return
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '42501') deny()
        else publish({ isLoading: false, error: 'Nachrichten konnten nicht geladen werden. Bitte erneut versuchen.' })
      } finally {
        controllers.delete(controller)
      }
    }
    const merge = (batch: RoundMessage[]) => {
      for (const row of batch) rows.set(row.id, row)
    }
    const reload = async () => {
      if (!active) return
      pending = true
      if (syncing) return
      syncing = true
      while (active && pending) {
        pending = false
        const initial = !initialized
        if (initial) publish({ isLoading: true })
        const result = await read(initial ? 'initial' : 'newer', cursor)
        if (!active) return
        // Another read may revoke access between read() resolving and this
        // continuation running. Check again at the actual merge boundary.
        if (!result || result.generation !== accessGeneration) continue
        const { batch } = result
        merge(batch)
        // Only ordered reads advance the safe cursor. A send receipt never does.
        cursor = Math.max(cursor, ...batch.map(row => row.round_seq))
        initialized = true
        publish({ isLoading: false, accessDenied: false, error: null,
          ...(initial ? { hasOlder: batch.length === ROUND_MESSAGE_PAGE_SIZE, initialLatestSeq: cursor } : {}) })
        if (!initial && batch.length === ROUND_MESSAGE_PAGE_SIZE) pending = true
      }
      syncing = false
    }
    const loadOlder = async () => {
      if (!active || !initialized || current.isLoadingOlder || !current.hasOlder) return
      const oldest = current.messages[0]?.round_seq
      if (oldest === undefined) return
      publish({ isLoadingOlder: true })
      const result = await read('older', oldest)
      if (!active) return
      if (result && result.generation === accessGeneration) {
        const { batch } = result
        merge(batch)
        publish({ hasOlder: batch.length === ROUND_MESSAGE_PAGE_SIZE, error: null })
      }
      publish({ isLoadingOlder: false })
    }
    actionsRef.current = { reload: () => { void reload() }, loadOlder: () => { void loadOlder() } }
    void reload()
    return () => {
      active = false
      actionsRef.current = null
      for (const controller of controllers) controller.abort()
    }
  }, [roundId, scopeKey])

  const reload = useCallback(() => actionsRef.current?.reload(), [])
  const loadOlder = useCallback(() => actionsRef.current?.loadOlder(), [])
  const reconcile = useFocusReconciliation(scopeKey, reload)
  useRealtimeInvalidation({ scopeKey, table: 'round_messages', filter: `round_id=eq.${roundId}`,
    insertOnly: true, reconcileOnReplicationReady: true, onInvalidate: reconcile, onSubscribed: reconcile })

  const visibleState = !scopeKey ? emptyState : state.scopeKey === scopeKey ? state : { ...emptyState, isLoading: true }
  return { ...visibleState, reload, loadOlder }
}
