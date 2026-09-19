import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import PlayModeHeader from '../components/PlayModeHeader'
import PlayMainContent from '../components/PlayMainContent'
import type { PlayTab } from '../components/PlayMainContent'
import PlayChatPanel from '../components/PlayChatPanel'
import { useRoundDetails } from '../hooks/useRoundDetails'
import { useRoundMembers } from '../hooks/useRoundMembers'
import { useFocusReconciliation } from '../hooks/useFocusReconciliation'
import { useRealtimeInvalidation } from '../hooks/useRealtimeInvalidation'
import { useRoundMessages } from '../hooks/useRoundMessages'
import { useSendRoundMessage } from '../hooks/useSendRoundMessage'
import { useSetActiveCharacter } from '../hooks/useSetActiveCharacter'
import { useRoundCharacters } from '../hooks/useRoundCharacters'
import type { RoundDetails, RoundMember } from '../types/round'

// Match the existing mobile breakpoint; CSS uses the same 48rem boundary.
const desktopQuery = '(width > 48rem)'
function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia(desktopQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches
const getServerSnapshot = () => false

type RoundPlayShellProps = {
  round: RoundDetails
  userId: string
  membership: RoundMember | undefined
  activeCharacter: { id: string; name: string } | undefined
  ownCharacters: Array<{ id: string; name: string }>
  isSpeakerLoading: boolean
  chat: ReturnType<typeof useRoundMessages>
  onAccessRefresh: () => void | Promise<void>
}

export function RoundPlayShell({ round, userId, membership, activeCharacter, ownCharacters, isSpeakerLoading, chat, onAccessRefresh }: RoundPlayShellProps) {
  const [activeTab, setActiveTab] = useState<PlayTab>('table')
  const [desktopChatOpen, setDesktopChatOpen] = useState(true)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const chatToggleRef = useRef<HTMLButtonElement>(null)
  const isDesktop = useSyncExternalStore(subscribeViewport, getDesktopSnapshot, getServerSnapshot)
  const isChatOpen = isDesktop ? desktopChatOpen : mobileChatOpen
  const setChatOpen = isDesktop ? setDesktopChatOpen : setMobileChatOpen
  const [lastSeenSeq, setLastSeenSeq] = useState(0)
  const unreadCount = chat.messages.filter(message => message.round_seq > Math.max(lastSeenSeq, chat.initialLatestSeq ?? 0)).length
  const markRead = useCallback((seq: number) => setLastSeenSeq(previous => Math.max(previous, seq)), [])
  const isGameMaster = membership?.role === 'game_master'
  const role = membership?.role
  const {
    isSubmitting: isSettingSpeaker,
    error: setSpeakerError,
    setActiveCharacter,
    resetState: resetSpeakerError,
  } = useSetActiveCharacter()
  const speakerScope = `${round.id}:${userId}:${role}`
  const speakerRequest = useRef({ generation: 0, busy: false })
  const [speakerChoice, setSpeakerChoice] = useState<{
    scope: string; characterId: string | null
  } | null>(null)
  useEffect(() => {
    const request = speakerRequest.current
    return () => { request.generation++; request.busy = false }
  }, [speakerScope])
  if (speakerChoice && speakerChoice.scope !== speakerScope) setSpeakerChoice(null)
  const pendingChoice = speakerChoice?.scope === speakerScope ? speakerChoice : null
  const selectedCharacterId = pendingChoice
    ? pendingChoice.characterId : membership?.active_character_id ?? null
  const selectedCharacter = ownCharacters.find(character => character.id === selectedCharacterId)
  const expectedCharacterId = isGameMaster ? selectedCharacterId : activeCharacter?.id ?? null
  const isChoosingSpeaker = Boolean(pendingChoice) || isSettingSpeaker
  const composer = useSendRoundMessage(round.id, userId, expectedCharacterId, chat.reload, onAccessRefresh)
  const disabledReason = chat.accessDenied ? 'Du hast keinen Zugriff auf diesen Chat.'
    : round.locked_at ? 'Diese Runde ist gesperrt. Nachrichten können nicht gesendet werden.'
    : round.status === 'archived' ? 'Archivierte Runden können nicht mehr beschrieben werden.'
    : !membership || chat.isLoading || isSpeakerLoading || isChoosingSpeaker
      ? 'Deine Schreibberechtigung wird geprüft …'
      : isGameMaster && selectedCharacterId && !selectedCharacter ? 'Der gewählte Charakter ist nicht verfügbar.'
      : !isGameMaster && !activeCharacter ? 'Wähle zuerst einen aktiven Charakter.' : null

  const changeSpeaker = async (characterId: string | null) => {
    if (!isGameMaster || isSpeakerLoading || speakerRequest.current.busy
      || characterId === (membership?.active_character_id ?? null)) return
    if (characterId !== null && !ownCharacters.some(character => character.id === characterId)) return
    const request = ++speakerRequest.current.generation
    speakerRequest.current.busy = true
    resetSpeakerError()
    setSpeakerChoice({ scope: speakerScope, characterId })
    try {
      const wasSet = await setActiveCharacter(round.id, characterId)
      if (request !== speakerRequest.current.generation) return
      if (wasSet) await onAccessRefresh()
    } finally {
      if (request === speakerRequest.current.generation) {
        speakerRequest.current.busy = false
        // Success, divergent canonical state, refresh failure and RPC failure
        // all release the pending choice. Never restore a captured server mode.
        setSpeakerChoice(null)
      }
    }
  }

  return (
    <section className="play-page" aria-label="Spielmodus">
      <PlayModeHeader
        roundId={round.id}
        roundName={round.name}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isChatOpen={isChatOpen}
        onChatToggle={() => setChatOpen(!isChatOpen)}
        chatToggleRef={chatToggleRef}
        unreadCount={unreadCount}
      />
      {round.locked_at && (
        <p className="locked-round-notice" role="status">Diese Runde wurde administrativ gesperrt.</p>
      )}
      <div className="play-workspace" data-chat-open={isDesktop && isChatOpen}>
        <PlayMainContent activeTab={activeTab} />
        <PlayChatPanel
          isDesktop={isDesktop}
          isOpen={isChatOpen}
          chat={chat}
          composer={composer}
          disabledReason={disabledReason}
          speakerName={isGameMaster ? selectedCharacterId === null ? 'Spielleitung' : selectedCharacter?.name ?? null : activeCharacter?.name ?? null}
          speakerSelection={isGameMaster ? {
            characterId: selectedCharacterId,
            characters: ownCharacters,
            error: setSpeakerError,
            disabled: isSpeakerLoading || isChoosingSpeaker,
            onChange: changeSpeaker,
          } : undefined}
          unreadCount={unreadCount}
          onRead={markRead}
          onClose={() => {
            setChatOpen(false)
            // The desktop close button disappears; return focus to its toggle.
            if (isDesktop) chatToggleRef.current?.focus()
          }}
        />
      </div>
    </section>
  )
}

function RoundPlayPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const { user } = useAuth()
  const { round: loadedRound, isLoading, error, reload } = useRoundDetails(roundId, user?.id)
  const { members, isLoading: membersLoading, error: membersError, reload: reloadMembers } = useRoundMembers(roundId, user?.id)
  // Use the same early membership-loss check as RoundDetailsPage.
  const isMembershipMissing = !membersLoading && !membersError &&
    !members.some(member => member.user_id === user?.id)
  const round = isMembershipMissing ? null : loadedRound
  const membership = members.find(member => member.user_id === user?.id)
  const characterList = useRoundCharacters(
    membership?.role === 'game_master' || membership?.active_character_id ? round?.id : undefined,
    `${user?.id}:${membership?.role}`,
    membership?.role === 'game_master' ? undefined : membership?.active_character_id ?? undefined,
    user?.id,
  )
  const ownCharacters = characterList.characters.filter(character =>
    character.owner_user_id === user?.id && character.round_id === round?.id)
  const activeCharacter = ownCharacters.find(character => character.id === membership?.active_character_id)
  const chat = useRoundMessages(round?.id, user?.id)
  const reloadCharacters = characterList.reload
  const reloadMessages = chat.reload
  const reloadAccess = useCallback(() => {
    reload()
    reloadCharacters()
    reloadMessages()
    return reloadMembers()
  }, [reload, reloadMembers, reloadCharacters, reloadMessages])
  const schedule = useFocusReconciliation(user?.id && roundId ? `${user.id}:${roundId}` : undefined, reloadAccess)
  // Keep access reconciliation alive while content is unavailable, just as on
  // RoundDetailsPage (for example when an existing round is unlocked again).
  const scopeKey = user?.id && roundId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roundId)
    ? `${user.id}:${roundId}`
    : undefined
  // Round/access and current speaker changes reconcile via the existing hooks.
  useRealtimeInvalidation({ scopeKey, table: 'rounds', filter: `id=eq.${roundId}`, onInvalidate: schedule })
  useRealtimeInvalidation({ scopeKey, table: 'round_memberships', filter: `round_id=eq.${roundId}`, includeInserts: true, onInvalidate: schedule })
  useRealtimeInvalidation({ scopeKey: membership?.role === 'game_master' || membership?.active_character_id ? scopeKey : undefined,
    table: 'characters', filter: membership?.role === 'game_master'
      ? `owner_user_id=eq.${user?.id}` : `id=eq.${membership?.active_character_id}`,
    includeInserts: membership?.role === 'game_master', onInvalidate: schedule })

  if (!isLoading && !error && round && user) {
    return <RoundPlayShell key={`${user.id}:${round.id}`} round={round} userId={user.id}
      membership={membership} activeCharacter={activeCharacter} ownCharacters={ownCharacters} isSpeakerLoading={characterList.isLoading}
      chat={chat} onAccessRefresh={reloadAccess} />
  }

  return (
    <section className="round-detail-page">
      <Link className="round-detail-back" to={roundId ? `/app/rounds/${roundId}` : '/app/rounds'}>
        ← Zur Rundenübersicht
      </Link>
      {isLoading ? (
        <p className="round-detail-state" role="status">Runde wird geladen...</p>
      ) : (
        <div className="round-detail-state" role="alert">
          <p>{error || 'Die Runde ist nicht verfügbar.'}</p>
          <button className="rounds-retry" type="button" onClick={reloadAccess}>Erneut versuchen</button>
        </div>
      )}
    </section>
  )
}

export default RoundPlayPage
