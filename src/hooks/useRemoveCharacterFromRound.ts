import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const removalError =
  'Der Charakter konnte nicht aus der Runde gelöst werden. Bitte versuche es erneut.'

export function useRemoveCharacterFromRound() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const removeCharacterFromRound = useCallback(
    async (characterId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!characterId) {
        setError(removalError)
        return false
      }

      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { error: requestError } = await supabase.rpc(
          'remove_character_from_round',
          {
            p_character_id: characterId,
          },
        )

        if (requestError) {
          setError(removalError)
          return false
        }

        return true
      } catch {
        setError(removalError)
        return false
      } finally {
        isRequestInFlightRef.current = false
        setIsSubmitting(false)
      }
    },
    [],
  )

  return {
    isSubmitting,
    error,
    removeCharacterFromRound,
    resetState,
  }
}
