const dayInMilliseconds = 24 * 60 * 60 * 1000
const recoveryPeriodInMilliseconds = 14 * dayInMilliseconds
const deletedAtFormatter = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function getCharacterRecoveryStatus(deletedAt: string) {
  const deletedAtTimestamp = new Date(deletedAt).getTime()

  if (!Number.isFinite(deletedAtTimestamp)) {
    return {
      isExpired: true,
      label: 'Wiederherstellungsfrist abgelaufen',
    }
  }

  const remainingMilliseconds =
    deletedAtTimestamp + recoveryPeriodInMilliseconds - Date.now()

  if (remainingMilliseconds <= 0) {
    return {
      isExpired: true,
      label: 'Wiederherstellungsfrist abgelaufen',
    }
  }

  const remainingDays = Math.ceil(remainingMilliseconds / dayInMilliseconds)

  return {
    isExpired: false,
    label:
      remainingDays <= 1
        ? 'Noch heute wiederherstellbar'
        : `Noch ${remainingDays} Tage wiederherstellbar`,
  }
}

export function formatCharacterDeletedAt(deletedAt: string) {
  const date = new Date(deletedAt)

  return Number.isNaN(date.getTime())
    ? 'Datum nicht verfügbar'
    : deletedAtFormatter.format(date)
}
