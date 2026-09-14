import { useEffect, useRef } from 'react'

type PlayChatPanelProps = {
  isDesktop: boolean
  isOpen: boolean
  onClose: () => void
}

function PlayChatPanel({ isDesktop, isOpen, onClose }: PlayChatPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
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

  const content = (
    <div className="play-chat-content">
      <header className="play-chat-header">
        <h2 id="play-chat-title">Chat</h2>
        <button className="play-button" type="button" onClick={onClose}>
          Chat schließen
        </button>
      </header>
      <div className="play-chat-history">
        <div>
          <p className="play-eyebrow">Platzhalter</p>
          <p>Hier ist später Platz für eure Unterhaltung.</p>
          <p className="play-chat-hint">Nachrichten, Würfelergebnisse und Systemmeldungen erscheinen hier, sobald der Chat verfügbar ist.</p>
        </div>
      </div>
      <div className="play-chat-composer">
        <label htmlFor="play-chat-message">Nachricht</label>
        <div className="play-chat-compose-row">
          <input id="play-chat-message" placeholder="Später verfügbar …" disabled aria-describedby="play-chat-unavailable" />
          <button className="play-button" type="button" disabled>Senden</button>
        </div>
        <p id="play-chat-unavailable">Vorschau – es werden keine Nachrichten gesendet.</p>
      </div>
    </div>
  )

  if (isDesktop) {
    return (
      <aside className="play-chat-panel" id="play-chat" aria-labelledby="play-chat-title" hidden={!isOpen}>
        {content}
      </aside>
    )
  }

  return (
    <dialog
      className="play-chat-dialog"
      id="play-chat"
      ref={dialogRef}
      aria-labelledby="play-chat-title"
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {content}
    </dialog>
  )
}

export default PlayChatPanel
