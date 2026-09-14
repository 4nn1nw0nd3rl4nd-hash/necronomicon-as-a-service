import { useLayoutEffect, useRef } from 'react'
import type { useRoundMessages } from '../hooks/useRoundMessages'
import type { useSendRoundMessage } from '../hooks/useSendRoundMessage'
import { isValidMessageBody, ROUND_MESSAGE_MAX_LENGTH } from '../types/roundMessage'

type PlayChatPanelProps = {
  isDesktop: boolean
  isOpen: boolean
  onClose: () => void
  chat: ReturnType<typeof useRoundMessages>
  composer: ReturnType<typeof useSendRoundMessage>
  disabledReason: string | null
  speakerName: string | null
  unreadCount: number
  onRead: (seq: number) => void
}
const timeFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' })

function PlayChatPanel({ isDesktop, isOpen, onClose, chat, composer, disabledReason, speakerName, unreadCount, onRead }: PlayChatPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef({ wasOpen: false, oldest: 0, height: 0, nearBottom: true })
  const latestSeq = chat.messages.at(-1)?.round_seq ?? 0
  const oldestSeq = chat.messages[0]?.round_seq ?? 0

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (isDesktop || !isOpen || !dialog) return
    dialog.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
    }
  }, [isDesktop, isOpen])

  useLayoutEffect(() => {
    const element = scrollRef.current
    const previous = positionRef.current
    if (!isOpen || !element) { previous.wasOpen = false; return }
    if (!previous.wasOpen || previous.nearBottom) {
      element.scrollTop = element.scrollHeight
      onRead(latestSeq)
    } else if (oldestSeq < previous.oldest) {
      // Preserve the visible passage when an older page is prepended.
      element.scrollTop += element.scrollHeight - previous.height
    }
    positionRef.current = {
      wasOpen: true, oldest: oldestSeq, height: element.scrollHeight,
      nearBottom: element.scrollHeight - element.scrollTop - element.clientHeight < 80,
    }
  }, [chat.messages, isOpen, isDesktop, latestSeq, oldestSeq, onRead])

  const jumpToLatest = () => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    positionRef.current.nearBottom = true
    onRead(latestSeq)
  }
  const canSend = !disabledReason && !composer.isSending && isValidMessageBody(composer.text)
  const send = () => { if (canSend) void composer.send() }
  const content = (
    <div className="play-chat-content">
      <header className="play-chat-header">
        <h2 id="play-chat-title">Chat <span className="play-chat-kind">IC</span></h2>
        <button className="play-button" type="button" onClick={onClose}>Chat schließen</button>
      </header>
      <div className="play-chat-history" ref={scrollRef} tabIndex={0} aria-label="Chatverlauf"
        onScroll={() => {
          const element = scrollRef.current
          if (!element) return
          positionRef.current.nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
          positionRef.current.height = element.scrollHeight
          if (positionRef.current.nearBottom) onRead(latestSeq)
        }}>
        {chat.hasOlder && <button className="play-button play-chat-older" type="button" disabled={chat.isLoadingOlder} onClick={chat.loadOlder}>
          {chat.isLoadingOlder ? 'Wird geladen …' : 'Ältere Nachrichten laden'}
        </button>}
        {chat.isLoading && <p role="status">Nachrichten werden geladen …</p>}
        {chat.error && <div className="play-chat-error" role="alert"><p>{chat.error}</p>
          <button className="play-button" type="button" onClick={chat.reload}>Erneut versuchen</button>
        </div>}
        {!chat.isLoading && !chat.error && chat.messages.length === 0 && <p>Noch keine Nachrichten. Hier beginnt eure gemeinsame Chronik.</p>}
        <ol className="play-chat-messages" aria-label="Chatnachrichten">
          {chat.messages.map(message => <li className="play-chat-message" data-speaker={message.speaker_kind} key={message.id}>
            <div className="play-chat-message-meta">
              <strong>{message.speaker_name_snapshot}</strong>
              <time dateTime={message.created_at}>{timeFormat.format(new Date(message.created_at))}</time>
            </div>
            <p>{message.body}</p>
          </li>)}
        </ol>
      </div>
      {unreadCount > 0 && <button className="play-button play-chat-new" type="button" onClick={jumpToLatest}>
        Neue Nachrichten ({unreadCount}) ↓
      </button>}
      <form className="play-chat-composer" onSubmit={event => { event.preventDefault(); send() }}>
        <label htmlFor="play-chat-message">{speakerName ? `Schreiben als ${speakerName}` : 'Nachricht'}</label>
        <textarea id="play-chat-message" rows={3} value={composer.text}
          placeholder="Deine IC-Nachricht …" disabled={Boolean(disabledReason) || composer.isSending}
          aria-describedby="play-chat-composer-hint" onChange={event => composer.setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }} />
        <div className="play-chat-compose-actions">
          <span>{Array.from(composer.text).length} / {ROUND_MESSAGE_MAX_LENGTH}</span>
          <button className="play-button" type="submit" disabled={!canSend}>{composer.isSending ? 'Wird gesendet …' : 'Senden'}</button>
        </div>
        <p id="play-chat-composer-hint">{disabledReason ?? 'Enter sendet · Shift+Enter fügt einen Zeilenumbruch ein.'}</p>
        {composer.error && <p className="play-chat-error" role="alert">{composer.error}</p>}
      </form>
    </div>
  )

  if (isDesktop) {
    return <aside className="play-chat-panel" id="play-chat" aria-labelledby="play-chat-title" hidden={!isOpen}>{content}</aside>
  }
  return <dialog className="play-chat-dialog" id="play-chat" ref={dialogRef} aria-labelledby="play-chat-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    {content}
  </dialog>
}
export default PlayChatPanel
