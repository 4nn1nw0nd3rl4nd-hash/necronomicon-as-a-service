import { useCallback, useRef, useState } from 'react'
import {
  characterPortraitBucket,
  getCharacterPortraitPath,
  isValidCharacterPortraitId,
} from '../lib/characterPortrait'
import { supabase } from '../lib/supabase'

const removeError =
  'Das Portrait konnte nicht entfernt werden. Bitte versuche es erneut.'

export function useRemoveCharacterPortrait() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const removeCharacterPortrait = useCallback(
    async (characterId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!isValidCharacterPortraitId(characterId)) {
        setError(removeError)
        return false
      }

      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { error: requestError } = await supabase.storage
          .from(characterPortraitBucket)
          .remove([getCharacterPortraitPath(characterId)])

        if (requestError) {
          setError(removeError)
          return false
        }

        return true
      } catch {
        setError(removeError)
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
    removeCharacterPortrait,
    resetState,
  }
}
