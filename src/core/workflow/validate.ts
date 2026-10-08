import type { SchemaInput, Values } from './types'

/** Field-level problems keyed by input key. Empty object means the values can be sent. */
export function validateValues(inputs: SchemaInput[], values: Values): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const i of inputs) {
    const v = i.key in values ? values[i.key] : i.default
    const c = i.constraints
    switch (i.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v)
        if (v === '' || v === null || v === undefined || !Number.isFinite(n)) errors[i.key] = 'Enter a number.'
        else if (c.min !== undefined && n < c.min) errors[i.key] = `Must be at least ${c.min}.`
        else if (c.max !== undefined && n > c.max) errors[i.key] = `Must be at most ${c.max}.`
        else if (c.integer && !Number.isInteger(n)) errors[i.key] = 'Must be a whole number.'
        break
      }
      case 'select':
        if (c.options && c.options.length && !c.options.includes(String(v))) {
          errors[i.key] = `"${String(v)}" is no longer offered by the server.`
        }
        break
      case 'file':
        if (c.required && !(typeof v === 'string' && v)) errors[i.key] = 'This image is required.'
        break
      case 'file-group': {
        const n = Array.isArray(v) ? v.filter(Boolean).length : 0
        if (c.minCount !== undefined && n < c.minCount) {
          errors[i.key] = `Add at least ${c.minCount} image${c.minCount === 1 ? '' : 's'}.`
        } else if (c.maxCount !== undefined && n > c.maxCount) {
          errors[i.key] = `At most ${c.maxCount} images. Remove ${n - c.maxCount}.`
        }
        break
      }
    }
  }
  return errors
}
