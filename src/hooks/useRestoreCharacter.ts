import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const restoreError =
  'Der Charakter konnte nicht wiederhergestellt werden. Bitte versuche es erneut.'

export function useRestoreCharacter() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const restoreCharacter = useCallback(
    async (characterId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!characterId) {
        setError(restoreError)
        return false
      }

      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { error: requestError } = await supabase.rpc(
          'restore_character',
          {
            p_character_id: characterId,
          },
        )

        if (requestError) {
          setError(restoreError)
          return false
        }

        return true
      } catch {
        setError(restoreError)
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
    restoreCharacter,
    resetState,
  }
}
