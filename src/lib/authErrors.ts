import type { AuthError } from '@supabase/supabase-js'

export const authErrorMessages = {
  invalidCredentials: 'E-Mail oder Passwort ist falsch.',
  emailAlreadyRegistered: 'Diese E-Mail-Adresse ist bereits registriert.',
  emailChangeEmpty: 'Bitte gib eine E-Mail-Adresse ein.',
  emailChangeInvalid: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  emailChangeUnchanged:
    'Die neue E-Mail-Adresse entspricht deiner aktuellen E-Mail-Adresse.',
  emailChangeRateLimit:
    'Zu viele E-Mails wurden angefordert. Bitte versuche es später erneut.',
  emailChangeSessionMissing:
    'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
  unknownEmailChange:
    'Die E-Mail-Adresse konnte nicht geändert werden. Bitte versuche es erneut.',
  usernameAlreadyTaken: 'Dieser Benutzername ist bereits vergeben.',
  invalidPassword:
    'Das Passwort muss mindestens 8 Zeichen sowie Groß- und Kleinbuchstaben, eine Zahl und ein Sonderzeichen enthalten.',
  unknownLogin: 'Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.',
  unknownRegistration:
    'Die Registrierung ist fehlgeschlagen. Bitte versuche es erneut.',
} as const

export function getEmailChangeErrorMessage(error?: AuthError) {
  if (!error) {
    return authErrorMessages.unknownEmailChange
  }

  if (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists'
  ) {
    return authErrorMessages.emailAlreadyRegistered
  }

  if (error.code === 'over_email_send_rate_limit') {
    return authErrorMessages.emailChangeRateLimit
  }

  if (
    error.code === 'email_address_invalid' ||
    error.code === 'validation_failed'
  ) {
    return authErrorMessages.emailChangeInvalid
  }

  if (
    error.code === 'session_not_found' ||
    error.code === 'session_expired' ||
    error.code === 'refresh_token_not_found' ||
    error.code === 'refresh_token_already_used' ||
    error.name === 'AuthSessionMissingError'
  ) {
    return authErrorMessages.emailChangeSessionMissing
  }

  return authErrorMessages.unknownEmailChange
}

export function getLoginErrorMessage(error?: AuthError) {
  if (
    error?.code === 'invalid_credentials' ||
    error?.message.toLowerCase().includes('invalid login credentials')
  ) {
    return authErrorMessages.invalidCredentials
  }

  return authErrorMessages.unknownLogin
}

export function getRegistrationErrorMessage(error?: AuthError) {
  if (!error) {
    return authErrorMessages.unknownRegistration
  }

  const message = error.message.toLowerCase()

  if (
    error.code === 'user_already_exists' ||
    error.code === 'email_exists' ||
    message.includes('already registered')
  ) {
    return authErrorMessages.emailAlreadyRegistered
  }

  if (
    error.code === 'weak_password' ||
    error.code === 'password_too_short' ||
    message.includes('password should be')
  ) {
    return authErrorMessages.invalidPassword
  }

  if (
    error.code === 'username_exists' ||
    message.includes('profiles_username_unique_ci') ||
    message.includes('duplicate key') ||
    message.includes('database error saving new user')
  ) {
    return authErrorMessages.usernameAlreadyTaken
  }

  return authErrorMessages.unknownRegistration
}
