import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const checkError =
  'Die Checkbox konnte nicht gespeichert werden. Bitte versuche es erneut.'

function getRequestKey(characterId: string, fieldKey: string) {
  return `${characterId}:${fieldKey}`
}

export function useSetCharacterCheck(characterId: string | undefined) {
  const [errorState, setErrorState] = useState<{
    characterId: string | undefined
    message: string
  } | null>(null)
  const [activeRequestKeys, setActiveRequestKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const activeRequestKeysRef = useRef(new Set<string>())

  const resetState = useCallback(() => {
    setErrorState(null)
  }, [])

  const setCharacterCheck = useCallback(
    (fieldKey: string, checked: boolean): Promise<boolean> | null => {
      if (!characterId || !fieldKey) {
        setErrorState({ characterId, message: checkError })
        return null
      }

      const requestKey = getRequestKey(characterId, fieldKey)

      if (activeRequestKeysRef.current.has(requestKey)) {
        return null
      }

      activeRequestKeysRef.current.add(requestKey)
      setActiveRequestKeys(new Set(activeRequestKeysRef.current))
      setErrorState(null)

      return (async () => {
        try {
          const { error: requestError } = await supabase.rpc(
            'set_character_check',
            {
              p_character_id: characterId,
              p_field_key: fieldKey,
              p_checked: checked,
            },
          )

          if (requestError) {
            setErrorState({ characterId, message: checkError })
            return false
          }

          return true
        } catch {
          setErrorState({ characterId, message: checkError })
          return false
        } finally {
          activeRequestKeysRef.current.delete(requestKey)
          setActiveRequestKeys(new Set(activeRequestKeysRef.current))
        }
      })()
    },
    [characterId],
  )

  const isFieldSubmitting = useCallback(
    (fieldKey: string) => {
      if (!characterId) {
        return false
      }

      return activeRequestKeys.has(getRequestKey(characterId, fieldKey))
    },
    [activeRequestKeys, characterId],
  )

  const hasPendingRequests = characterId
    ? [...activeRequestKeys].some((requestKey) =>
        requestKey.startsWith(`${characterId}:`),
      )
    : false

  return {
    error:
      errorState && errorState.characterId === characterId
        ? errorState.message
        : null,
    hasPendingRequests,
    isFieldSubmitting,
    setCharacterCheck,
    resetState,
  }
}
