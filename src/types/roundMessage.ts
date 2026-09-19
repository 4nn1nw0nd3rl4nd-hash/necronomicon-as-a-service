export const ROUND_MESSAGE_MAX_LENGTH = 4000
export const ROUND_MESSAGE_PAGE_SIZE = 50

type RoundMessageEnvelope = {
  id: string
  round_id: string
  round_seq: number
  author_user_id: string | null
  recipient_user_id: string | null
  character_id: string | null
  speaker_name_snapshot: string
  client_request_id: string
  created_at: string
}

export type CharacterMessage = RoundMessageEnvelope & {
  kind: 'character_message'
  speaker_kind: 'character' | 'game_master'
  body: string
}

export type SystemMessage = RoundMessageEnvelope & {
  kind: 'system_message'
  speaker_kind: 'system'
  body: string
}

export type DiceRollDetails = {
  message_id: string
  dice_count: number
  dice_sides: number
  modifier: number
  results: number[]
  raw_total: number
  total: number
}

export type DiceRollMessage = RoundMessageEnvelope & {
  kind: 'dice_roll'
  speaker_kind: 'character' | 'game_master'
  body: null
  // NULL is the visible defensive state for a missing or malformed detail row.
  dice_roll: DiceRollDetails | null
}

export type RoundMessage = CharacterMessage | SystemMessage | DiceRollMessage

export const roundMessageFields = [
  'id', 'round_id', 'round_seq', 'author_user_id', 'recipient_user_id',
  'character_id', 'speaker_kind', 'speaker_name_snapshot', 'kind', 'body',
  'client_request_id', 'created_at',
  'dice_roll:round_message_dice_rolls(message_id,dice_count,dice_sides,modifier,results,raw_total,total)',
].join(',')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function decodeEnvelope(value: Record<string, unknown>): RoundMessageEnvelope | null {
  if (typeof value.id !== 'string' || typeof value.round_id !== 'string'
    || !isInteger(value.round_seq) || value.round_seq < 1
    || !isNullableString(value.author_user_id)
    || !isNullableString(value.recipient_user_id)
    || !isNullableString(value.character_id)
    || typeof value.speaker_name_snapshot !== 'string'
    || typeof value.client_request_id !== 'string'
    || typeof value.created_at !== 'string') return null
  return {
    id: value.id,
    round_id: value.round_id,
    round_seq: value.round_seq,
    author_user_id: value.author_user_id,
    recipient_user_id: value.recipient_user_id,
    character_id: value.character_id,
    speaker_name_snapshot: value.speaker_name_snapshot,
    client_request_id: value.client_request_id,
    created_at: value.created_at,
  }
}

function relationObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) return value[0]
  return null
}

function decodeDiceRollDetails(value: unknown, messageId: string): DiceRollDetails | null {
  const detail = relationObject(value)
  if (!detail || detail.message_id !== messageId
    || !isInteger(detail.dice_count) || !isInteger(detail.dice_sides)
    || !isInteger(detail.modifier) || !isInteger(detail.raw_total)
    || !isInteger(detail.total) || !Array.isArray(detail.results)
    || !detail.results.every(isInteger)) return null
  return {
    message_id: detail.message_id,
    dice_count: detail.dice_count,
    dice_sides: detail.dice_sides,
    modifier: detail.modifier,
    results: [...detail.results],
    raw_total: detail.raw_total,
    total: detail.total,
  }
}

export function decodeRoundMessage(value: unknown): RoundMessage | null {
  if (!isRecord(value)) return null
  const envelope = decodeEnvelope(value)
  if (!envelope) return null
  if (value.kind === 'character_message') {
    if ((value.speaker_kind !== 'character' && value.speaker_kind !== 'game_master')
      || typeof value.body !== 'string') return null
    return { ...envelope, kind: value.kind, speaker_kind: value.speaker_kind, body: value.body }
  }
  if (value.kind === 'system_message') {
    if (value.speaker_kind !== 'system' || typeof value.body !== 'string') return null
    return { ...envelope, kind: value.kind, speaker_kind: value.speaker_kind, body: value.body }
  }
  if (value.kind === 'dice_roll') {
    if ((value.speaker_kind !== 'character' && value.speaker_kind !== 'game_master')
      || value.body !== null) return null
    return {
      ...envelope,
      kind: value.kind,
      speaker_kind: value.speaker_kind,
      body: null,
      dice_roll: decodeDiceRollDetails(value.dice_roll, envelope.id),
    }
  }
  return null
}

export function getRoundMessageSequence(value: unknown): number | null {
  if (!isRecord(value) || !isInteger(value.round_seq) || value.round_seq < 1) return null
  return value.round_seq
}

export function formatDiceExpression(details: DiceRollDetails) {
  const modifier = details.modifier > 0 ? `+${details.modifier}` : details.modifier < 0 ? String(details.modifier) : ''
  return `${details.dice_count}d${details.dice_sides}${modifier}`
}

export function isValidMessageBody(body: string) {
  return body.trim().length > 0 && Array.from(body).length <= ROUND_MESSAGE_MAX_LENGTH
}
