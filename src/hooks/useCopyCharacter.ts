import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const copyError =
  'Der Charakter konnte nicht kopiert werden. Bitte versuche es erneut.'

export function useCopyCharacter() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const copyCharacter = useCallback(
    async (characterId: string): Promise<string | null> => {
      if (isRequestInFlightRef.current) {
        return null
      }

      if (!characterId) {
        setError(copyError)
        return null
      }

      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { data, error: requestError } = await supabase.rpc(
          'copy_character',
          {
            p_character_id: characterId,
          },
        )

        if (requestError || typeof data !== 'string') {
          setError(copyError)
          return null
        }

        return data
      } catch {
        setError(copyError)
        return null
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
    copyCharacter,
    resetState,
  }
}
