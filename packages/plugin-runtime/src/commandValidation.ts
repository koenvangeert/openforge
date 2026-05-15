import type { JsonSchema } from '@openforge/plugin-sdk'

function schemaTypeMatches(expected: string, value: unknown): boolean {
  switch (expected) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'null': return value === null
    default: return true
  }
}

export function validateSchemaValue(schema: JsonSchema | undefined, value: unknown, label: string): void {
  if (!schema) return

  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  if (oneOf) {
    const errors: string[] = []
    for (const candidate of oneOf) {
      try {
        validateSchemaValue(candidate as JsonSchema, value, label)
        return
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    throw new Error(`${label} does not match any allowed schema: ${errors.join('; ')}`)
  }

  const type = schema.type
  if (typeof type === 'string' && !schemaTypeMatches(type, value)) {
    throw new Error(`${label} expected ${type}`)
  }

  if (type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (typeof key === 'string' && !(key in objectValue)) {
        throw new Error(`${label} missing required property ${key}`)
      }
    }

    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties as Record<string, JsonSchema>
      : {}
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in objectValue) {
        validateSchemaValue(propertySchema, objectValue[key], `${label}.${key}`)
      }
    }
  }

  if (type === 'array' && Array.isArray(value) && schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    value.forEach((item, index) => validateSchemaValue(schema.items as JsonSchema, item, `${label}[${index}]`))
  }
}
