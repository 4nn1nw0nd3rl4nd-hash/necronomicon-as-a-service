import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import type { CharacterSummary } from '../types/character'

type MyCharactersState = {
  userId: string | undefined
  characters: CharacterSummary[]
  isLoading: boolean
  error: string | null
}
const initialState: MyCharactersState = { userId: undefined, characters: [], isLoading: false, error: null }

export function useMyCharacters() {
  const { user } = useAuth()
  const userId = user?.id
  const [state, setState] = useState<MyCharactersState>(initialState)
  const reloadRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!userId) return
    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let controller: AbortController | undefined
    const loadCharacters = async () => {
      if (!active) return
      pending = true
      if (inFlight) return
      inFlight = true
      while (active && pending) {
        pending = false
        controller = new AbortController()
        if (!hasLoaded) setState({ ...initialState, userId, isLoading: true })
        try {
          const { data, error } = await supabase
            .from('characters')
            .select(`
              id,
              name,
              owner_user_id,
              round_id,
              template_key,
              template_version,
              created_at,
              updated_at
            `)
            .eq('owner_user_id', userId)
            .is('deleted_at', null)
            .order('updated_at', { ascending: false })
            .abortSignal(controller.signal)
            .overrideTypes<CharacterSummary[], { merge: false }>()
          if (!active) return
          if (error && error.code !== '42501') throw error
          hasLoaded = true
          setState({
            userId, characters: error ? [] : data ?? [], isLoading: false,
            error: error ? 'Die Charaktere konnten nicht geladen werden.' : null,
          })
        } catch {
          if (!active) return
          if (!hasLoaded) setState({ ...initialState, userId, error: 'Die Charaktere konnten nicht geladen werden.' })
        }
      }
      inFlight = false
    }
    reloadRef.current = () => { void loadCharacters() }
    void loadCharacters()
    return () => {
      active = false
      reloadRef.current = null
      controller?.abort()
    }
  }, [userId])

  const reload = useCallback(() => { reloadRef.current?.() }, [])
  if (!userId) return { ...initialState, reload }
  if (state.userId !== userId) return { ...initialState, isLoading: true, reload }
  return { ...state, reload }
}
