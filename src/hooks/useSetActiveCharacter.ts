import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const setActiveCharacterError =
  'Der aktive Charakter konnte nicht geändert werden. Bitte versuche es erneut.'

export function useSetActiveCharacter() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeCharacterId, setActiveCharacterId] = useState<
    string | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const setActiveCharacter = useCallback(
    async (characterId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!characterId) {
        setError(setActiveCharacterError)
        return false
      }

      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setActiveCharacterId(characterId)
      setError(null)

      try {
        const { error: requestError } = await supabase.rpc(
          'set_active_character',
          {
            p_character_id: characterId,
          },
        )

        if (requestError) {
          setError(setActiveCharacterError)
          return false
        }

        return true
      } catch {
        setError(setActiveCharacterError)
        return false
      } finally {
        isRequestInFlightRef.current = false
        setIsSubmitting(false)
        setActiveCharacterId(null)
      }
    },
    [],
  )

  return {
    isSubmitting,
    activeCharacterId,
    error,
    setActiveCharacter,
    resetState,
  }
}
