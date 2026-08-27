import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import type {
  RoundDetails,
  RoundStatus,
  UpdateRoundInput,
} from '../types/round'

type UpdateRoundState = {
  isSubmitting: boolean
  error: string | null
  isSuccess: boolean
}

const initialState: UpdateRoundState = {
  isSubmitting: false,
  error: null,
  isSuccess: false,
}

const allowedStatuses: readonly RoundStatus[] = [
  'active',
  'paused',
  'archived',
]

const sessionError =
  'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'
const unavailableError = 'Die Runde konnte nicht gespeichert werden.'
const technicalError =
  'Die Runde konnte nicht gespeichert werden. Bitte versuche es erneut.'

export function useUpdateRound() {
  const { session, user } = useAuth()
  const [state, setState] = useState<UpdateRoundState>(initialState)
  const isRequestInFlightRef = useRef(false)

  const resetState = useCallback(() => {
    setState((currentState) => ({
      ...initialState,
      isSubmitting: currentState.isSubmitting,
    }))
  }, [])

  const updateRound = useCallback(
    async (
      roundId: string,
      input: UpdateRoundInput,
    ): Promise<RoundDetails | null> => {
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

      if (!roundId.trim()) {
        setState({ ...initialState, error: unavailableError })
        return null
      }

      if (!normalizedName) {
        setState({
          ...initialState,
          error: 'Bitte gib einen Namen für die Runde ein.',
        })
        return null
      }

      if (!allowedStatuses.includes(input.status)) {
        setState({ ...initialState, error: unavailableError })
        return null
      }

      isRequestInFlightRef.current = true
      setState({ ...initialState, isSubmitting: true })

      try {
        const { data, error } = await supabase
          .from('rounds')
          .update({
            name: normalizedName,
            system: normalizedSystem,
            description: normalizedDescription,
            appointment: normalizedAppointment,
            status: input.status,
          })
          .eq('id', roundId)
          .select(
            'id, name, system, description, appointment, status, created_at, updated_at',
          )
          .maybeSingle()
          .overrideTypes<RoundDetails, { merge: false }>()

        if (error || !data) {
          setState({ ...initialState, error: unavailableError })
          return null
        }

        setState({ ...initialState, isSuccess: true })
        return data
      } catch {
        setState({ ...initialState, error: technicalError })
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
    updateRound,
    resetState,
  }
}
