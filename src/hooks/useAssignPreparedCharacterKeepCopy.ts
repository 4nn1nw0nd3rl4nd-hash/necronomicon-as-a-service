import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const assignmentError =
  'Der Charakter konnte nicht mit Kopie zugewiesen werden. Bitte versuche es erneut.'

export function useAssignPreparedCharacterKeepCopy() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const assignPreparedCharacterKeepCopy = useCallback(
    async (characterId: string, userId: string): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!characterId || !userId) {
        setError(assignmentError)
        return false
      }

      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { error: requestError } = await supabase.rpc(
          'assign_prepared_character_keep_copy',
          {
            p_character_id: characterId,
            p_user_id: userId,
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
    assignPreparedCharacterKeepCopy,
    resetState,
  }
}
