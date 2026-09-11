import { useCallback, useEffect, useRef, useState } from 'react'
import {
  characterPortraitBucket,
  getCharacterPortraitPath,
  isValidCharacterPortraitId,
} from '../lib/characterPortrait'
import { supabase } from '../lib/supabase'

type CharacterPortraitState = {
  characterId: string | undefined
  userId: string | undefined
  portraitUrl: string | null
  isLoading: boolean
  error: string | null
}
const initialState: CharacterPortraitState = {
  characterId: undefined, userId: undefined,
  portraitUrl: null, isLoading: false, error: null,
}
const loadError = 'Das Portrait konnte nicht geladen werden.'

export function useCharacterPortrait(characterId: string | undefined, userId: string | undefined) {
  const [state, setState] = useState<CharacterPortraitState>(initialState)
  const actionsRef = useRef<{
    reload: (force?: boolean) => void
    clear: () => void
  } | null>(null)
  const hasValidCharacterId = isValidCharacterPortraitId(characterId)

  useEffect(() => {
    if (!userId || !hasValidCharacterId) return
    let active = true
    let inFlight = false
    let pending = false
    let hasLoaded = false
    let generation = 0
    let objectUrl: string | null = null
    let version: string | undefined
    let controller: AbortController | undefined
    const revoke = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = null
      version = undefined
    }
    const load = async () => {
      if (!active) return
      pending = true
      if (inFlight) return
      inFlight = true
      while (active && pending) {
        pending = false
        const currentGeneration = generation
        const isCurrent = () => active && generation === currentGeneration
        controller = new AbortController()
        if (!hasLoaded) setState({ ...initialState, characterId, userId, isLoading: true })
        try {
          const bucket = supabase.storage.from(characterPortraitBucket)
          const { data: files, error: listError } = await bucket.list(
            characterId, { limit: 10, search: 'portrait' },
            { signal: controller.signal, cache: 'no-store' },
          )
          if (!isCurrent()) continue
          if (listError) throw listError
          const file = files.find(file => file.name === 'portrait')
          if (!file) {
            revoke()
            hasLoaded = true
            setState({ ...initialState, characterId, userId })
            continue
          }
          // Real Storage metadata, not characters.updated_at: a check must not
          // invalidate the image. Object ID also distinguishes delete/recreate.
          const nextVersion = file.updated_at
            ? JSON.stringify([file.id, file.updated_at, file.metadata?.eTag]) : undefined
          if (objectUrl && nextVersion && version === nextVersion) continue
          const { data, error } = await bucket.download(
            getCharacterPortraitPath(characterId), { cacheNonce: nextVersion },
            { signal: controller.signal, cache: 'no-store' },
          )
          if (!isCurrent()) continue
          if (error) throw error
          const nextUrl = URL.createObjectURL(data)
          revoke()
          objectUrl = nextUrl
          version = nextVersion
          hasLoaded = true
          setState({ ...initialState, characterId, userId, portraitUrl: nextUrl })
        } catch (error) {
          if (!isCurrent()) continue
          const status = error && typeof error === 'object' && 'statusCode' in error
            ? String(error.statusCode) : ''
          if (['401', '403', '404'].includes(status)) {
            revoke()
            hasLoaded = true
            setState({ ...initialState, characterId, userId, error: loadError })
          } else if (!hasLoaded) {
            setState({ ...initialState, characterId, userId, error: loadError })
          }
          // Transient background errors retain the displayed image.
        }
      }
      inFlight = false
    }
    actionsRef.current = {
      reload(force = false) {
        if (force) {
          generation++
          version = undefined
        }
        void load()
      },
      clear() {
        generation++
        pending = false
        controller?.abort()
        revoke()
        hasLoaded = true
        setState({ ...initialState, characterId, userId })
      },
    }
    void load()
    return () => {
      active = false
      actionsRef.current = null
      controller?.abort()
      revoke()
    }
  }, [characterId, hasValidCharacterId, userId])

  // Explicit local upload/retry forces a fresh read; reconciliation first checks
  // metadata and avoids downloading unchanged blobs.
  const reload = useCallback(() => actionsRef.current?.reload(true), [])
  const reconcile = useCallback(() => actionsRef.current?.reload(), [])
  const clearPortrait = useCallback(() => actionsRef.current?.clear(), [])
  const actions = { reload, reconcile, clearPortrait }
  if (!userId || !hasValidCharacterId) return { ...initialState, ...actions }
  if (state.characterId !== characterId || state.userId !== userId) {
    return { ...initialState, isLoading: true, ...actions }
  }
  return { ...state, ...actions }
}
