export const passwordRequirementsHint =
  'Mindestens 8 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen.'

export function isPasswordValid(password: string): boolean {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9\s]/.test(password)
  )
}
