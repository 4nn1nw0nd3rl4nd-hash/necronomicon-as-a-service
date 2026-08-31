import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type UpdateCharacterState = {
  isSubmitting: boolean
  error: string | null
}

const initialState: UpdateCharacterState = {
  isSubmitting: false,
  error: null,
}

const unavailableError =
  'Der Charakter konnte nicht gespeichert werden. Bitte versuche es erneut.'

function isDataObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}

export function useUpdateCharacter() {
  const [state, setState] = useState<UpdateCharacterState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const updateCharacter = useCallback(
    async (
      characterId: string,
      name: string,
      data: Record<string, unknown>,
    ): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      const normalizedName = name.trim()

      if (!characterId || !normalizedName || normalizedName.length > 100) {
        setState({ ...initialState, error: unavailableError })
        return false
      }

      if (!isDataObject(data)) {
        setState({ ...initialState, error: unavailableError })
        return false
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { error } = await supabase.rpc('update_character', {
          p_character_id: characterId,
          p_name: normalizedName,
          p_data: data,
        })

        if (error) {
          setState({ ...initialState, error: unavailableError })
          return false
        }

        return true
      } catch {
        setState({ ...initialState, error: unavailableError })
        return false
      } finally {
        isRequestInFlightRef.current = false
        setState((currentState) => ({
          ...currentState,
          isSubmitting: false,
        }))
      }
    },
    [],
  )

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    updateCharacter,
    resetState,
  }
}
