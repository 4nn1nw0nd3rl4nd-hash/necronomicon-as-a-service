export type CharacterTemplateFieldType =
  | 'short'
  | 'long'
  | 'check'
  | 'character_name'

export type CharacterTemplateSectionWidth = 'small' | 'half' | 'full'

export type CharacterTemplateField = {
  key: string
  label: string
  type: CharacterTemplateFieldType
  order: number
  showLabel?: boolean
}

export type CharacterTemplateGroup = {
  key: string
  label: string
  order: number
  fields: CharacterTemplateField[]
}

export type CharacterTemplateSection = {
  key: string
  label: string
  order: number
  width: CharacterTemplateSectionWidth
  fields?: CharacterTemplateField[]
  groups?: CharacterTemplateGroup[]
}

export type CharacterTemplateDefinition = {
  key: string
  name: string
  version: number
  sections: CharacterTemplateSection[]
}
