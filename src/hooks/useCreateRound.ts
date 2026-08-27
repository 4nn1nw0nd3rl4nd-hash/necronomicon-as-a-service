import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import type { CreateRoundInput } from '../types/round'

type CreateRoundState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: CreateRoundState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const unknownError =
  'Die Runde konnte nicht erstellt werden. Bitte versuche es erneut.'

export function useCreateRound() {
  const { session, user } = useAuth()
  const [state, setState] = useState<CreateRoundState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const createRound = useCallback(
    async (input: CreateRoundInput): Promise<string | null> => {
      if (isRequestInFlightRef.current) {
        return null
      }

      const normalizedName = input.name.trim()
      const normalizedSystem = input.system.trim() || null
      const normalizedDescription = input.description.trim() || null
      const normalizedAppointment = input.appointment.trim() || null

      if (!session || !user) {
        setState({ ...initialState, error: sessionError })
        return null
      }

      if (!normalizedName) {
        setState({
          ...initialState,
          error: 'Bitte gib einen Namen für die Runde ein.',
        })
        return null
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { data, error } = await supabase.rpc('create_round', {
          p_name: normalizedName,
          p_system: normalizedSystem,
          p_description: normalizedDescription,
          p_appointment: normalizedAppointment,
        })

        if (error || typeof data !== 'string') {
          setState({ ...initialState, error: unknownError })
          return null
        }

        setState({ ...initialState, isSuccess: true })
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
    [session, user],
  )

  return {
    isSubmitting: state.isSubmitting,
    error: state.error,
    isSuccess: state.isSuccess,
    createRound,
    resetState,
  }
}
