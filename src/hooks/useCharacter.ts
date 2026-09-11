import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CharacterDetails } from '../types/character'

// null confirms absence/access loss; undefined means a failed or obsolete read.
type ReadResult = CharacterDetails | null | undefined

type CharacterState = {
  characterId: string | undefined
  userId: string | undefined
  roundId: string | null | undefined
  character: CharacterDetails | null
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
}

const initialState: CharacterState = {
  characterId: undefined,
  userId: undefined,
  roundId: undefined,
  character: null,
  isLoading: false,
  isRefreshing: false,
  error: null,
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function useCharacter(characterId: string | undefined, userId: string | undefined) {
  const [state, setState] = useState<CharacterState>(initialState)
  const actionsRef = useRef<{
    reload: () => Promise<ReadResult>
    beginWrite: () => () => void
    updateField: (key: string, value: boolean) => void
  } | null>(null)
  const hasValidCharacterId = Boolean(characterId && uuidPattern.test(characterId))

  useEffect(() => {
    if (!userId || !hasValidCharacterId) return
    let active = true
    let pending = false
    let hasLoaded = false
    let ownWrites = 0
    let writeGeneration = 0
    let inFlight: Promise<ReadResult> | undefined
    let controller: AbortController | undefined

    const drain = async (): Promise<ReadResult> => {
      let result: ReadResult
      while (active && pending && ownWrites === 0) {
        pending = false
        const generation = writeGeneration
        controller = new AbortController()
        if (hasLoaded) {
          setState(current => ({ ...current, isRefreshing: true }))
        } else {
          setState({ ...initialState, characterId, userId, isLoading: true, isRefreshing: true })
        }
        try {
          const { data, error } = await supabase
            .from('characters')
            .select(`
              id, name, owner_user_id, round_id, template_key, template_version,
              data, created_by_user_id, deleted_at, created_at, updated_at,
              round:rounds ( locked_at )
            `)
            .eq('id', characterId)
            .is('deleted_at', null)
            .abortSignal(controller.signal)
            .maybeSingle()
            .overrideTypes<CharacterDetails, { merge: false }>()
          if (!active) return
          // A read started before an own write cannot replace its optimistic UI.
          if (generation !== writeGeneration || ownWrites > 0) {
            pending = true
            continue
          }
          if (error && error.code !== '42501') throw error
          const character = error || data?.deleted_at ? null : data
          result = character
          hasLoaded = true
          const isRefreshing = pending
          setState(current => ({
            characterId, userId, character,
            // Retain only the dependency ID on access loss, so an unlock/GM
            // change can reconcile the view without retaining private content.
            roundId: character ? character.round_id : current.roundId,
            isLoading: false, isRefreshing,
            error: character ? null : 'Charakter nicht verfügbar.',
          }))
        } catch {
          if (!active) return
          if (generation !== writeGeneration || ownWrites > 0) {
            pending = true
            continue
          }
          result = undefined
          if (hasLoaded) {
            const isRefreshing = pending
            setState(current => ({ ...current, isRefreshing }))
          } else {
            setState({ ...initialState, characterId, userId, error: 'Der Charakter konnte nicht geladen werden.' })
          }
        }
      }
      return result
    }

    const reload = (): Promise<ReadResult> => {
      if (!active) return Promise.resolve(undefined)
      pending = true
      if (inFlight) return inFlight
      if (ownWrites > 0) return Promise.resolve(undefined)
      inFlight = drain().finally(() => {
        inFlight = undefined
        if (active && pending && ownWrites === 0) void reload()
      })
      return inFlight
    }

    actionsRef.current = {
      reload,
      beginWrite() {
        ownWrites++
        writeGeneration++
        let finished = false
        return () => {
          if (!active || finished) return
          finished = true
          ownWrites--
          // Always reconcile, also after a failed/ambiguous RPC response.
          void reload()
        }
      },
      updateField(key, value) {
        if (!active) return
        setState(current => !current.character ? current : {
          ...current,
          character: { ...current.character, data: { ...current.character.data, [key]: value } },
        })
      },
    }
    void reload()
    return () => {
      active = false
      actionsRef.current = null
      controller?.abort()
    }
  }, [characterId, hasValidCharacterId, userId])

  const reload = useCallback(() => actionsRef.current?.reload() ?? Promise.resolve(undefined), [])
  const beginWrite = useCallback(() => actionsRef.current?.beginWrite() ?? (() => {}), [])
  const updateCharacterDataField = useCallback((key: string, value: boolean) => {
    actionsRef.current?.updateField(key, value)
  }, [])
  const actions = { reload, beginWrite, updateCharacterDataField }

  if (!userId || !hasValidCharacterId) {
    return { ...initialState, error: userId ? 'Charakter nicht verfügbar.' : null, ...actions }
  }
  if (state.characterId !== characterId || state.userId !== userId) {
    return { ...initialState, isLoading: true, ...actions }
  }
  return { ...state, ...actions }
}
