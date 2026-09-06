import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RoundMemberProfile } from '../types/round'

type SearchState = {
  key: string
  results: RoundMemberProfile[]
  status: 'loading' | 'success' | 'error'
}

export function useRoundPlayerSuggestions(roundId: string, query: string) {
  const prefix = query.trim()
  const key = JSON.stringify([roundId, prefix])
  const [state, setState] = useState<SearchState | null>(null)

  useEffect(() => {
    if (!prefix) return
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setState({ key, results: [], status: 'loading' })
      try {
        const { data, error } = await supabase
          .rpc('search_round_player_candidates', {
            p_round_id: roundId,
            p_prefix: prefix,
          })
          .abortSignal(controller.signal)
          .overrideTypes<RoundMemberProfile[], { merge: false }>()
        if (active) {
          const failed = Boolean(error) || !Array.isArray(data)
          setState({
            key,
            results: !failed && Array.isArray(data) ? data : [],
            status: failed ? 'error' : 'success',
          })
        }
      } catch {
        if (active) setState({ key, results: [], status: 'error' })
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key, prefix, roundId])

  return {
    results: prefix && state?.key === key ? state.results : [],
    status: !prefix ? 'idle' : state?.key === key ? state.status : 'loading',
  }
}
