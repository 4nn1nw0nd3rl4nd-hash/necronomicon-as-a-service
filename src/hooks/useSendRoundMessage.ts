import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isValidMessageBody } from '../types/roundMessage'
import type { RoundMessage } from '../types/roundMessage'

const errorMessages: Record<string, string> = {
  CHAT_NOT_AUTHORIZED: 'Du hast keinen Zugriff auf diesen Chat.',
  CHAT_ROUND_LOCKED: 'Diese Runde ist gesperrt. Nachrichten können nicht gesendet werden.',
  CHAT_ROUND_ARCHIVED: 'Archivierte Runden können nicht mehr beschrieben werden.',
  CHAT_NO_ACTIVE_CHARACTER: 'Wähle zuerst einen aktiven Charakter.',
  CHAT_CHARACTER_UNAVAILABLE: 'Der erwartete Charakter ist nicht mehr verfügbar. Bitte prüfe deinen aktiven Charakter.',
  CHAT_IDENTITY_CHANGED: 'Deine Sprecheridentität hat sich geändert. Prüfe sie vor dem erneuten Senden.',
  CHAT_INVALID_BODY: 'Die Nachricht muss Text enthalten und darf höchstens 4.000 Zeichen lang sein.',
  CHAT_REQUEST_CONFLICT: 'Diese Anfrage wurde bereits für eine andere Nachricht verwendet. Bitte ändere den Entwurf.',
}
type Attempt = { body: string; requestId: string; characterId: string | null; intentVersion: number }
type SendState = { scopeKey: string; text: string; isSending: boolean; error: string | null; pendingAttempt: Attempt | null }

export function useSendRoundMessage(
  roundId: string,
  userId: string,
  expectedCharacterId: string | null,
  onSent: () => void,
  onAccessRefresh: () => void,
) {
  const scopeKey = `${userId}:${roundId}`
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
    if (lifetime.attempt?.body !== text) lifetime.attempt = null
    setState({ scopeKey, text, isSending: false, error: null, pendingAttempt: lifetime.attempt })
  }, [scopeKey])

  const send = async (retryOriginal = false) => {
    const lifetime = lifetimeRef.current
    if (!lifetime?.active || lifetime.scopeKey !== scopeKey || lifetime.inFlight || !isValidMessageBody(visible.text)) return false
    if (retryOriginal && !lifetime.attempt) return false
    lifetime.inFlight = true
    // A running attempt is immutable. A changed intent gets a new request; an
    // explicit retry always retains the original body, identity and request ID.
    const reusable = lifetime.attempt && (retryOriginal || lifetime.attempt.intentVersion === currentIntent.version)
    const attempt = reusable ? lifetime.attempt! : {
      body: visible.text, requestId: crypto.randomUUID(), characterId: expectedCharacterId,
      intentVersion: currentIntent.version,
    }
    lifetime.attempt = attempt
    lifetime.controller = new AbortController()
    setState({ scopeKey, text: attempt.body, isSending: true, error: null, pendingAttempt: null })
    try {
      const { data, error } = await supabase.rpc('send_round_message', {
        p_round_id: roundId, p_body: attempt.body, p_client_request_id: attempt.requestId,
        p_expected_active_character_id: attempt.characterId,
      }).abortSignal(lifetime.controller.signal).single().overrideTypes<RoundMessage, { merge: false }>()
      if (!lifetime.active) return false
      if (error) {
        if (error.message === 'CHAT_IDENTITY_CHANGED' || error.message === 'CHAT_CHARACTER_UNAVAILABLE' || error.message === 'CHAT_NO_ACTIVE_CHARACTER') {
          lifetime.attempt = null // Definitive rejection; the next click may use the refreshed identity.
        }
        setState({ scopeKey, text: attempt.body, isSending: false,
          error: errorMessages[error.message] ?? 'Senden nicht bestätigt. Bitte erneut versuchen.', pendingAttempt: lifetime.attempt })
        onAccessRefresh()
        return false
      }
      if (!data || data.client_request_id !== attempt.requestId || data.round_id !== roundId) throw new Error('Unconfirmed send')
      lifetime.attempt = null
      setState({ scopeKey, text: '', isSending: false, error: null, pendingAttempt: null })
      // Fetch the whole authorized delta, not just this receipt: other sends may precede it.
      onSent()
      return true
    } catch {
      if (!lifetime.active) return false
      setState({ scopeKey, text: attempt.body, isSending: false,
        error: 'Senden nicht bestätigt. Bitte erneut versuchen.', pendingAttempt: attempt })
      return false
    } finally {
      if (lifetime.active) lifetime.inFlight = false
    }
  }
  return {
    text: visible.text, isSending: visible.isSending, error: visible.error, setText,
    send: () => send(), retry: () => send(true),
    hasDifferentPendingAttempt: Boolean(visible.pendingAttempt && visible.pendingAttempt.intentVersion !== currentIntent.version),
  }
}
