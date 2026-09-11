import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const copyError =
  'Der Charakter konnte nicht kopiert werden. Bitte versuche es erneut.'

export function useCopyCharacter() {
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

  const copyCharacter = useCallback(
    async (characterId: string): Promise<string | null> => {
      if (isRequestInFlightRef.current) {
        return null
      }

      if (!characterId) {
        setError(copyError)
        return null
      }

      const generation = lifecycle.current
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

        if (generation !== lifecycle.current) return null
        if (requestError || typeof data !== 'string') {
          setError(copyError)
          return null
        }

        return data
      } catch {
        if (generation !== lifecycle.current) return null
        setError(copyError)
        return null
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
    copyCharacter,
    resetState,
  }
}
