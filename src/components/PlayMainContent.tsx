export type PlayTab = 'table' | 'character' | 'notes'

const content = {
  table: {
    title: 'Spieltisch',
    description: 'Hier erscheint später die aktuelle Szene mit Karte, Tokens und Spielobjekten.',
  },
  character: {
    title: 'Charakter',
    description: 'Hier wird später der aktive Charakter direkt im Spielmodus angezeigt.',
  },
  notes: {
    title: 'Notizbuch',
    description: 'Hier entstehen später persönliche Notizen, Rundenjournal und freigegebene Spielinformationen.',
  },
}

function PlayMainContent({ activeTab }: { activeTab: PlayTab }) {
  const { title, description } = content[activeTab]

  return (
    <section
      className={`play-main-content play-main-content-${activeTab}`}
      id="play-main-content"
      role="tabpanel"
      aria-labelledby={`play-tab-${activeTab}`}
      tabIndex={0}
    >
      <div className="play-placeholder">
        <span className="play-placeholder-mark" aria-hidden="true">◇</span>
        <p className="play-eyebrow">Platzhalter</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  )
}

export default PlayMainContent
