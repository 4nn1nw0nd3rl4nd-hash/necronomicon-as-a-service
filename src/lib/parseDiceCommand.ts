export type DiceCommand = {
  diceCount: number
  diceSides: number
  modifier: number
}

export const GENERIC_QUICK_DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const

export function isValidDiceCommand(dice: DiceCommand): boolean {
  return Number.isInteger(dice.diceCount) && dice.diceCount >= 1 && dice.diceCount <= 50
    && Number.isInteger(dice.diceSides) && dice.diceSides >= 2 && dice.diceSides <= 1000
    && Number.isInteger(dice.modifier) && dice.modifier >= -9999 && dice.modifier <= 9999
}

export function isDiceCommand(text: string): boolean {
  return /^\/r(?:\s|$)/.test(text.trimStart())
}

export function parseDiceCommand(text: string): DiceCommand | null {
  if (!isDiceCommand(text)) return null
  const expression = text.trim().slice(2).trim()
  const match = /^([0-9]+)?[dD]([0-9]+)(?:\s*([+-])\s*([0-9]+))?$/.exec(expression)
  if (!match) return null

  const diceCount = match[1] === undefined ? 1 : Number(match[1])
  const diceSides = Number(match[2])
  const magnitude = match[4] === undefined ? 0 : Number(match[4])
  const modifier = match[3] === '-' ? -magnitude : magnitude
  if (!isValidDiceCommand({ diceCount, diceSides, modifier })) return null

  return { diceCount, diceSides, modifier }
}
