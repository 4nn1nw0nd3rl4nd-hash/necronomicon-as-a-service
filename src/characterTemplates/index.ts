import type { CharacterTemplateDefinition } from './types'
import { vaesenTemplateV1 } from './vaesen/v1'

export type {
  CharacterTemplateDefinition,
  CharacterTemplateField,
  CharacterTemplateFieldType,
  CharacterTemplateGroup,
  CharacterTemplateSection,
  CharacterTemplateSectionWidth,
} from './types'
export { vaesenTemplateV1 } from './vaesen/v1'

export const implementedCharacterTemplates: readonly CharacterTemplateDefinition[] =
  [vaesenTemplateV1]

export const availableCharacterTemplates: readonly CharacterTemplateDefinition[] =
  [vaesenTemplateV1]

export function findCharacterTemplate(key: string, version: number) {
  return implementedCharacterTemplates.find(
    (template) => template.key === key && template.version === version,
  )
}
