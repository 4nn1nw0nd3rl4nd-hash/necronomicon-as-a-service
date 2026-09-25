import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isDiceCommand, isValidDiceCommand, parseDiceCommand } from '../lib/parseDiceCommand'
import type { DiceCommand } from '../lib/parseDiceCommand'
import { decodeRoundMessage, isValidMessageBody } from '../types/roundMessage'
import { useSendDiceRoll } from './useSendDiceRoll'

const errorMessages: Record<string, string> = {
  CHAT_NOT_AUTHORIZED: 'Du hast keinen Zugriff auf diesen Chat.',
  CHAT_ROUND_LOCKED: 'Diese Runde ist gesperrt. Nachrichten können nicht gesendet werden.',
  CHAT_ROUND_ARCHIVED: 'Archivierte Runden können nicht mehr beschrieben werden.',
  CHAT_NO_ACTIVE_CHARACTER: 'Wähle zuerst einen aktiven Charakter.',
  CHAT_CHARACTER_UNAVAILABLE: 'Der erwartete Charakter ist nicht mehr verfügbar. Bitte prüfe deinen aktiven Charakter.',
  CHAT_IDENTITY_CHANGED: 'Deine Sprecheridentität hat sich geändert. Prüfe sie vor dem erneuten Senden.',
  CHAT_INVALID_BODY: 'Die Nachricht muss Text enthalten und darf höchstens 4.000 Zeichen lang sein.',
  CHAT_REQUEST_CONFLICT: 'Diese Anfrage wurde bereits für eine andere Nachricht verwendet. Bitte ändere den Entwurf.',
  DICE_INVALID_PARAMETERS: 'Ungültiger Würfelbefehl. Erlaubt ist z. B. /r 3d6+5.',
  DICE_STORED_ROLL_INCOMPLETE: 'Der gespeicherte Wurf ist unvollständig. Bitte versuche es später erneut.',
}
const invalidDiceCommand = 'Ungültiger Würfelbefehl. Erlaubt ist z. B. /r 3d6+5.'
const diceRequestConflict = 'Diese Würfelanfrage wurde bereits anders verwendet. Bitte erneut senden.'
const additionalDefinitiveDiceErrors = new Set([
  'CHAT_ROUND_ARCHIVED', 'CHAT_ROUND_LOCKED', 'CHAT_NOT_AUTHORIZED',
  'CHAT_REQUEST_CONFLICT', 'DICE_INVALID_PARAMETERS', 'DICE_STORED_ROLL_INCOMPLETE',
])
type Attempt = {
  source: 'composer' | 'quickDice'
  body: string | null
  dice: DiceCommand | null
  requestId: string
  characterId: string | null
  intentVersion: number
}
type SendState = { scopeKey: string; text: string; isSending: boolean; error: string | null; pendingAttempt: Attempt | null }

function sameDice(left: DiceCommand | null, right: DiceCommand | null) {
  return Boolean(left && right && left.diceCount === right.diceCount
    && left.diceSides === right.diceSides && left.modifier === right.modifier)
}

export function useSendRoundMessage(
  roundId: string,
  userId: string,
  expectedCharacterId: string | null,
  onSent: () => void,
  onAccessRefresh: () => void,
) {
  const scopeKey = `${userId}:${roundId}`
  const sendDiceRoll = useSendDiceRoll(roundId)
  const [state, setState] = useState<SendState>({ scopeKey, text: '', isSending: false, error: null, pendingAttempt: null })
  const [intent, setIntent] = useState({ characterId: expectedCharacterId, version: 0 })
  const currentIntent = intent.characterId === expectedCharacterId
    ? intent : { characterId: expectedCharacterId, version: intent.version + 1 }
  if (currentIntent !== intent) setIntent(currentIntent)
  const lifetimeRef = useRef<{
    scopeKey: string; active: boolean; inFlight: boolean; attempt: Attempt | null; controller?: AbortController
  } | null>(null)

  useEffect(() => {
    const lifetime = { scopeKey, active: true, inFlight: false, attempt: null as Attempt | null, controller: undefined as AbortController | undefined }
    lifetimeRef.current = lifetime
    return () => {
      lifetime.active = false
      lifetime.controller?.abort()
      lifetimeRef.current = null
    }
  }, [scopeKey])

  const visible = state.scopeKey === scopeKey ? state : { scopeKey, text: '', isSending: false, error: null, pendingAttempt: null }
  const setText = useCallback((text: string) => {
    const lifetime = lifetimeRef.current
    if (!lifetime?.active || lifetime.scopeKey !== scopeKey || lifetime.inFlight) return
    // An unchanged draft retries its original request, including after a timeout.
    if (lifetime.attempt?.source === 'composer' && lifetime.attempt.body !== text) lifetime.attempt = null
    setState({ scopeKey, text, isSending: false, error: null, pendingAttempt: lifetime.attempt })
  }, [scopeKey])

  const sendIntent = async (
    source: Attempt['source'],
    body: string | null,
    dice: DiceCommand | null,
    retryOriginal = false,
  ) => {
    const lifetime = lifetimeRef.current
    if (!lifetime?.active || lifetime.scopeKey !== scopeKey || lifetime.inFlight) return false
    if (dice && !isValidDiceCommand(dice)) return false
    if (retryOriginal && (!lifetime.attempt || lifetime.attempt.source !== 'composer')) return false
    lifetime.inFlight = true
    // A running attempt is immutable. A changed intent gets a new request; an
    // explicit retry always retains the original body, identity and request ID.
    const reusable = lifetime.attempt && lifetime.attempt.source === source
      && (retryOriginal || (lifetime.attempt.intentVersion === currentIntent.version
        && (source === 'quickDice' ? sameDice(lifetime.attempt.dice, dice) : lifetime.attempt.body === body)))
    const attempt = reusable ? lifetime.attempt! : {
      source, body, dice: dice ? { ...dice } : null,
      requestId: crypto.randomUUID(), characterId: expectedCharacterId,
      intentVersion: currentIntent.version,
    }
    const draft = source === 'quickDice' ? visible.text : attempt.body ?? visible.text
    lifetime.attempt = attempt
    lifetime.controller = new AbortController()
    setState({ scopeKey, text: draft, isSending: true, error: null, pendingAttempt: null })
    try {
      const { data, error } = attempt.dice
        ? await sendDiceRoll(attempt.dice, attempt.requestId, attempt.characterId, lifetime.controller.signal)
        : await supabase.rpc('send_round_message', {
          p_round_id: roundId, p_body: attempt.body!, p_client_request_id: attempt.requestId,
          p_expected_active_character_id: attempt.characterId,
        }).abortSignal(lifetime.controller.signal).single().overrideTypes<unknown, { merge: false }>()
      if (!lifetime.active) return false
      if (error) {
        if (error.message === 'CHAT_IDENTITY_CHANGED' || error.message === 'CHAT_CHARACTER_UNAVAILABLE'
          || error.message === 'CHAT_NO_ACTIVE_CHARACTER'
          || (attempt.dice && additionalDefinitiveDiceErrors.has(error.message))) {
          lifetime.attempt = null // A definitive rejection ends this intent; the next submit gets a new ID.
        }
        setState({ scopeKey, text: draft, isSending: false,
          error: attempt.dice && error.message === 'CHAT_REQUEST_CONFLICT'
            ? diceRequestConflict : errorMessages[error.message] ?? 'Senden nicht bestätigt. Bitte erneut versuchen.',
          pendingAttempt: lifetime.attempt })
        onAccessRefresh()
        return false
      }
      const message = decodeRoundMessage(data)
      if (!message || message.client_request_id !== attempt.requestId || message.round_id !== roundId
        || (attempt.dice && (message.kind !== 'dice_roll' || !message.dice_roll))) throw new Error('Unconfirmed send')
      lifetime.attempt = null
      setState({ scopeKey, text: source === 'quickDice' ? draft : '', isSending: false, error: null, pendingAttempt: null })
      // Fetch the whole authorized delta, not just this receipt: other sends may precede it.
      onSent()
      return true
    } catch {
      if (!lifetime.active) return false
      setState({ scopeKey, text: draft, isSending: false,
        error: 'Senden nicht bestätigt. Bitte erneut versuchen.', pendingAttempt: attempt })
      return false
    } finally {
      if (lifetime.active) lifetime.inFlight = false
    }
  }

  const send = (retryOriginal = false) => {
    const diceCommand = isDiceCommand(visible.text)
    if (!diceCommand && !isValidMessageBody(visible.text)) return Promise.resolve(false)
    const dice = diceCommand ? parseDiceCommand(visible.text) : null
    if (diceCommand && !dice) {
      const lifetime = lifetimeRef.current
      setState({ scopeKey, text: visible.text, isSending: false, error: invalidDiceCommand,
        pendingAttempt: lifetime?.attempt ?? null })
      return Promise.resolve(false)
    }
    return sendIntent('composer', visible.text, dice, retryOriginal)
  }

  const sendDice = (dice: DiceCommand) => sendIntent('quickDice', null, dice)

  return {
    text: visible.text, isSending: visible.isSending, error: visible.error, setText,
    send: () => send(), sendDice, retry: () => send(true),
    hasDifferentPendingAttempt: Boolean(visible.pendingAttempt?.source === 'composer'
      && visible.pendingAttempt.intentVersion !== currentIntent.version),
  }
}
