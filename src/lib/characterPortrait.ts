export const characterPortraitBucket = 'character-portraits'
export const characterPortraitMaxFileSize = 5_242_880

export const characterPortraitMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

const characterIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidCharacterPortraitId(
  characterId: string | undefined,
): characterId is string {
  return Boolean(characterId && characterIdPattern.test(characterId))
}

export function getCharacterPortraitPath(characterId: string) {
  return `${characterId}/portrait`
}

export function isAllowedCharacterPortraitMimeType(mimeType: string) {
  return characterPortraitMimeTypes.some(
    (allowedMimeType) => allowedMimeType === mimeType,
  )
}
