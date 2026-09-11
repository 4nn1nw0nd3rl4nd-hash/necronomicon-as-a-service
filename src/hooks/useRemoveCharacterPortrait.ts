import { useCallback, useEffect, useRef, useState } from 'react'
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
  const lifecycle = useRef(0)
  useEffect(() => {
    const generation = ++lifecycle.current
    return () => { lifecycle.current = generation + 1 }
  }, [])

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

      const generation = lifecycle.current
      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { error: requestError } = await supabase.storage
          .from(characterPortraitBucket)
          .remove([getCharacterPortraitPath(characterId)])

        if (generation !== lifecycle.current) return false
        if (requestError) {
          setError(removeError)
          return false
        }

        return true
      } catch {
        if (generation !== lifecycle.current) return false
        setError(removeError)
        return false
      } finally {
        isRequestInFlightRef.current = false
        if (generation === lifecycle.current) setIsSubmitting(false)
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
