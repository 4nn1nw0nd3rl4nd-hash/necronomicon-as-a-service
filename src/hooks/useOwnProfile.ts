import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/profile'

type ProfileState = {
  userId: string | undefined
  profile: Profile | null
  isLoading: boolean
  error: string | null
  isSaving: boolean
  saveError: string | null
}
const initialState: ProfileState = {
  userId: undefined, profile: null, isLoading: false, error: null,
  isSaving: false, saveError: null,
}
const fields = 'id, username, display_name, role, is_superadmin, deletion_pending_at, created_at, updated_at'

// Owned once by ProfileProvider; useProfile consumers only read its context.
export function useOwnProfile(userId: string | undefined) {
  const [state, setState] = useState<ProfileState>(initialState)
  const actionsRef = useRef<{
    reload: () => void
    updateDisplayName: (name: string) => Promise<Profile | null>
  } | null>(null)
  useEffect(() => {
    if (!userId) return
    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let saving = false
    let writeGeneration = 0
    let controller: AbortController | undefined
    const load = async () => {
      if (!active) return
      pending = true
      if (inFlight || saving) return
      inFlight = true
      while (active && pending && !saving) {
        pending = false
        const generation = writeGeneration
        controller = new AbortController()
        if (!hasLoaded) setState({ ...initialState, userId, isLoading: true })
        try {
          const { data, error } = await supabase.from('profiles').select(fields)
            .eq('id', userId).abortSignal(controller.signal).maybeSingle()
            .overrideTypes<Profile, { merge: false }>()
          if (!active) return
          if (generation !== writeGeneration || saving) { pending = true; continue }
          if (error && error.code !== '42501') throw error
          hasLoaded = true
          setState(current => ({
            ...current, userId, profile: error ? null : data, isLoading: false,
            error: error ? 'Das Profil konnte nicht geladen werden.' : null,
          }))
        } catch {
          if (!active) return
          if (generation !== writeGeneration || saving) { pending = true; continue }
          if (!hasLoaded) setState({ ...initialState, userId, error: 'Das Profil konnte nicht geladen werden.' })
        }
      }
      inFlight = false
    }
    actionsRef.current = {
      reload: () => { void load() },
      async updateDisplayName(displayName) {
        if (!active || saving) return null
        const normalized = displayName.trim()
        if (!normalized) {
          setState(current => ({ ...current, saveError: 'Der Anzeigename darf nicht leer sein.' }))
          return null
        }
        saving = true
        writeGeneration++
        setState(current => ({ ...current, isSaving: true, saveError: null }))
        try {
          const { data, error } = await supabase.from('profiles')
            .update({ display_name: normalized }).eq('id', userId)
            .select(fields).single().overrideTypes<Profile, { merge: false }>()
          if (!active) return null
          if (error) throw error
          hasLoaded = true
          setState({ ...initialState, userId, profile: data })
          return data
        } catch {
          if (!active) return null
          setState(current => ({ ...current, isSaving: false, saveError: 'Der Anzeigename konnte nicht gespeichert werden.' }))
          return null
        } finally {
          saving = false
          // The write response has no atomic version guard; reconcile the
          // complete authorized profile, including any concurrent role change.
          if (active) void load()
        }
      },
    }
    void load()
    return () => {
      active = false
      actionsRef.current = null
      controller?.abort()
    }
  }, [userId])
  const reload = useCallback(() => actionsRef.current?.reload(), [])
  const updateDisplayName = useCallback((name: string) =>
    actionsRef.current?.updateDisplayName(name) ?? Promise.resolve(null), [])
  const actions = { reload, updateDisplayName }
  if (!userId) return { ...initialState, ...actions }
  if (state.userId !== userId) return { ...initialState, userId, isLoading: true, ...actions }
  return { ...state, ...actions }
}
