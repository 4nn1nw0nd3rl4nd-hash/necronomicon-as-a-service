import type { AuthError } from '@supabase/supabase-js'

export const authErrorMessages = {
  invalidCredentials: 'E-Mail oder Passwort ist falsch.',
  emailAlreadyRegistered: 'Diese E-Mail-Adresse ist bereits registriert.',
  usernameAlreadyTaken: 'Dieser Benutzername ist bereits vergeben.',
  invalidPassword: 'Das Passwort erfüllt die Anforderungen nicht.',
  unknownLogin: 'Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.',
  unknownRegistration:
    'Die Registrierung ist fehlgeschlagen. Bitte versuche es erneut.',
} as const

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
