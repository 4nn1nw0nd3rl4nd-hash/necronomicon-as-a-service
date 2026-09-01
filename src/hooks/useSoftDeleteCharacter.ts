import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const deleteError =
  'Der Charakter konnte nicht in den Papierkorb verschoben werden. Bitte versuche es erneut.'

export function useSoftDeleteCharacter() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const softDeleteCharacter = useCallback(
    async (characterId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!characterId) {
        setError(deleteError)
        return false
      }

      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { error: requestError } = await supabase.rpc(
          'soft_delete_character',
          {
            p_character_id: characterId,
          },
        )

        if (requestError) {
          setError(deleteError)
          return false
        }

        return true
      } catch {
        setError(deleteError)
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
    softDeleteCharacter,
    resetState,
  }
}
