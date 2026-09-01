import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import type { CharacterTemplateDefinition } from '../characterTemplates'
import { supabase } from '../lib/supabase'

type CreateCharacterState = {
  isSubmitting: boolean
  error: string | null
}

const initialState: CreateCharacterState = {
  isSubmitting: false,
  error: null,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const unknownError =
  'Der Charakter konnte nicht erstellt werden. Bitte versuche es erneut.'

type UseCreateCharacterOptions = {
  roundId?: string | null
  isPrepared?: boolean
}

export function useCreateCharacter({
  roundId = null,
  isPrepared = false,
}: UseCreateCharacterOptions = {}) {
  const { session, user } = useAuth()
  const [state, setState] = useState<CreateCharacterState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const createCharacter = useCallback(
    async (
      name: string,
      template: Pick<CharacterTemplateDefinition, 'key' | 'version'>,
    ): Promise<string | null> => {
      if (isRequestInFlightRef.current) {
        return null
      }

      const normalizedName = name.trim()

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return null
      }

      if (!normalizedName) {
        setState({
          ...initialState,
          error: 'Bitte gib einen Namen für den Charakter ein.',
        })
        return null
      }

      if (normalizedName.length > 100) {
        setState({
          ...initialState,
          error: 'Der Name darf höchstens 100 Zeichen lang sein.',
        })
        return null
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { data, error } = await supabase.rpc('create_character', {
          p_name: normalizedName,
          p_template_key: template.key,
          p_template_version: template.version,
          p_round_id: roundId,
          p_is_prepared: isPrepared,
        })

        if (error || typeof data !== 'string') {
          setState({ ...initialState, error: unknownError })
          return null
        }

        return data
      } catch {
        setState({ ...initialState, error: unknownError })
        return null
      } finally {
        isRequestInFlightRef.current = false
        setState((currentState) => ({
          ...currentState,
          isSubmitting: false,
        }))
      }
    },
    [isPrepared, roundId, session, user],
  )

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    createCharacter,
    resetState,
  }
}
