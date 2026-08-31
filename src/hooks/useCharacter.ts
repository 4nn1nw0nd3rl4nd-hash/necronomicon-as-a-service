import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CharacterDetails } from '../types/character'

type CharacterState = {
  characterId: string | undefined
  character: CharacterDetails | null
  isLoading: boolean
  error: string | null
}

const initialState: CharacterState = {
  characterId: undefined,
  character: null,
  isLoading: false,
  error: null,
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidCharacterId(
  characterId: string | undefined,
): characterId is string {
  return Boolean(characterId && uuidPattern.test(characterId))
}

export function useCharacter(characterId: string | undefined) {
  const [state, setState] = useState<CharacterState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)
  const hasValidCharacterId = isValidCharacterId(characterId)

  useEffect(() => {
    if (!hasValidCharacterId) {
      return
    }

    let isCurrentRequest = true

    const loadCharacter = async () => {
      setState({
        characterId,
        character: null,
        isLoading: true,
        error: null,
      })

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
            data,
            created_by_user_id,
            deleted_at,
            created_at,
            updated_at
          `)
          .eq('id', characterId)
          .is('deleted_at', null)
          .maybeSingle()
          .overrideTypes<CharacterDetails, { merge: false }>()

        if (!isCurrentRequest) {
          return
        }

        if (error) {
          setState({
            characterId,
            character: null,
            isLoading: false,
            error: 'Der Charakter konnte nicht geladen werden.',
          })
          return
        }

        if (!data) {
          setState({
            characterId,
            character: null,
            isLoading: false,
            error: 'Charakter nicht verfügbar.',
          })
          return
        }

        setState({
          characterId,
          character: data,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isCurrentRequest) {
          return
        }

        setState({
          characterId,
          character: null,
          isLoading: false,
          error: 'Der Charakter konnte nicht geladen werden.',
        })
      }
    }

    void loadCharacter()

    return () => {
      isCurrentRequest = false
    }
  }, [characterId, hasValidCharacterId, reloadKey])

  const reload = useCallback(() => {
    if (isValidCharacterId(characterId)) {
      setReloadKey((currentKey) => currentKey + 1)
    }
  }, [characterId])

  const updateCharacterDataField = useCallback(
    (fieldKey: string, value: boolean) => {
      setState((currentState) => {
        if (
          currentState.characterId !== characterId ||
          !currentState.character
        ) {
          return currentState
        }

        return {
          ...currentState,
          character: {
            ...currentState.character,
            data: {
              ...currentState.character.data,
              [fieldKey]: value,
            },
          },
        }
      })
    },
    [characterId],
  )

  if (!hasValidCharacterId) {
    return {
      character: null,
      isLoading: false,
      error: 'Charakter nicht verfügbar.',
      reload,
      updateCharacterDataField,
    }
  }

  if (state.characterId !== characterId) {
    return {
      character: null,
      isLoading: true,
      error: null,
      reload,
      updateCharacterDataField,
    }
  }

  return {
    character: state.character,
    isLoading: state.isLoading,
    error: state.error,
    reload,
    updateCharacterDataField,
  }
}
