import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const assignmentError =
  'Der Charakter konnte der Runde nicht zugewiesen werden. Bitte versuche es erneut.'

export function useAssignCharacterToRound() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const assignCharacterToRound = useCallback(
    async (characterId: string, roundId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!characterId || !roundId) {
        setError(assignmentError)
        return false
      }

      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { error: requestError } = await supabase.rpc(
          'assign_character_to_round',
          {
            p_character_id: characterId,
            p_round_id: roundId,
          },
        )

        if (requestError) {
          setError(assignmentError)
          return false
        }

        return true
      } catch {
        setError(assignmentError)
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
    assignCharacterToRound,
    resetState,
  }
}
