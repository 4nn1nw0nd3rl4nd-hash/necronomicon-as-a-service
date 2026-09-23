export type DiceCommand = {
  diceCount: number
  diceSides: number
  modifier: number
}

export function isDiceCommand(text: string): boolean {
  return /^\/r(?:\s|$)/.test(text.trimStart())
}

export function parseDiceCommand(text: string): DiceCommand | null {
  if (!isDiceCommand(text)) return null
  const expression = text.trim().slice(2).trim()
  const match = /^([0-9]+)[dD]([0-9]+)(?:\s*([+-])\s*([0-9]+))?$/.exec(expression)
  if (!match) return null

  const diceCount = Number(match[1])
  const diceSides = Number(match[2])
  const magnitude = match[4] === undefined ? 0 : Number(match[4])
  const modifier = match[3] === '-' ? -magnitude : magnitude
  if (!Number.isInteger(diceCount) || diceCount < 1 || diceCount > 50
    || !Number.isInteger(diceSides) || diceSides < 2 || diceSides > 1000
    || !Number.isInteger(modifier) || modifier < -9999 || modifier > 9999) return null

  return { diceCount, diceSides, modifier }
}
