import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { DiceCommand } from '../lib/parseDiceCommand'

export function useSendDiceRoll(roundId: string) {
  return useCallback(async (
    dice: DiceCommand,
    requestId: string,
    expectedCharacterId: string | null,
    signal: AbortSignal,
  ) => {
    return supabase.rpc('send_round_dice_roll', {
      p_round_id: roundId,
      p_dice_count: dice.diceCount,
      p_dice_sides: dice.diceSides,
      p_modifier: dice.modifier,
      p_client_request_id: requestId,
      p_expected_active_character_id: expectedCharacterId,
    }).abortSignal(signal).single().overrideTypes<unknown, { merge: false }>()
  }, [roundId])
}
