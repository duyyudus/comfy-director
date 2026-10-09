import { describe, expect, it } from 'vitest'
import { applyValues, buildSchema, checkWorkflow, detectFormat, diffSchemas, keyFromTitle, validateValues } from '../src/core/workflow'
import { fl2v, objectInfo, r2v, t2v } from './fixtures'

describe('keys', () => {
  it('derives keys from titles', () => {
    expect(keyFromTitle('Float (Duration)')).toBe('duration')
    expect(keyFromTitle('Float (duration)')).toBe('duration')
    expect(keyFromTitle('Input Text (Prompt)')).toBe('prompt')
    expect(keyFromTitle('Boolean (Enable Lightning LoRA)')).toBe('enable lightning lora')
    expect(keyFromTitle('  Int  ')).toBe('int')
  })
})

describe('format', () => {
  it('accepts API format and counts nodes', () => {
    const r = detectFormat(r2v())
    expect(r.format).toBe('api')
    if (r.format === 'api') {
      expect(r.nodeCount).toBe(30)
      expect(r.nodeTypeCount).toBe(22)
    }
  })
  it('rejects UI format', () => {
    expect(detectFormat({ nodes: [], links: [], version: 0.4 }).format).toBe('ui')
  })
})

describe('schema', () => {
  it('discovers r2v inputs', () => {
    const s = buildSchema(r2v(), null, objectInfo)
    const keys = s.inputs.map((i) => i.key)
    expect(keys).toEqual(['prompt', 'aspect_ratio', 'megapixels', 'duration', 'enable lightning lora', 'ref_images'])
    expect(s.inputs.find((i) => i.key === 'aspect_ratio')?.type).toBe('select')
    const group = s.inputs.find((i) => i.key === 'ref_images')!
    expect(group.type).toBe('file-group')
    expect(group.constraints.maxCount).toBe(9)
    expect(group.constraints.minCount).toBe(1)
    if (group.target.kind === 'file-group') expect(group.target.slots.map((x) => x.nodeId)).toEqual(['137', '149', '147', '148', '150', '151'])
    // Steps primitives only feed switches: discovered but hidden by default
    expect(s.discovery.candidates.filter((c) => !c.defaultExposed).map((c) => c.id)).toEqual(['full', 'lightning lora'])
    expect(s.seedTargets).toEqual([{ nodeId: '129', field: 'noise_seed' }])
    // Resolution fields are standard inputs, so they are no longer left as fields to expose by hand.
    expect(s.discovery.fields.filter((f) => f.suggested).map((f) => f.field)).toEqual([])
    // An older overrides file that exposes one of them does not add it twice.
    const again = buildSchema(r2v(), { expose: [{ class: 'ResolutionSelector', field: 'megapixels' }] }, objectInfo)
    expect(again.inputs.filter((i) => i.key === 'megapixels')).toHaveLength(1)
    expect(again.duplicateKeys).toEqual([])
  })

  it('discovers fl2v optional frames and the prompt typed on the node', () => {
    const s = buildSchema(fl2v(), null, objectInfo)
    const byKey = Object.fromEntries(s.inputs.map((i) => [i.key, i]))
    expect(Object.keys(byKey).sort()).toEqual(['aspect_ratio', 'duration', 'enable lightning lora', 'first_frame', 'last_frame', 'megapixels', 'prompt'])
    expect(byKey.first_frame.constraints.required).toBe(false)
    expect(byKey.prompt.type).toBe('text')
    expect(s.duplicateKeys).toEqual([])
    expect(s.discovery.candidates.map((c) => c.id)).toContain('int#2')
    // An older overrides file that exposes the same prompt field does not add it twice.
    const again = buildSchema(fl2v(), { expose: [{ class: 'MiniMaxH3ImageToVideo', field: 'prompt' }] }, objectInfo)
    expect(again.inputs.filter((i) => i.key === 'prompt')).toHaveLength(1)
  })

  it('gives same-titled inputs unique keys instead of blocking', () => {
    const both = { inputs: { int: { hidden: false }, 'int#2': { hidden: false } } }
    const s = buildSchema(t2v(), both, objectInfo)
    expect(s.duplicateKeys).toEqual([])
    expect(s.inputs.map((i) => i.key)).toEqual(expect.arrayContaining(['int', 'int#2']))
    // A renamed label becomes the key.
    const named = buildSchema(t2v(), { inputs: { int: { hidden: false, label: 'full-steps' }, 'int#2': { hidden: false, label: 'turbo-steps' } } }, objectInfo)
    expect(named.inputs.map((i) => i.key)).toEqual(expect.arrayContaining(['full-steps', 'turbo-steps']))
    expect(named.inputs.find((i) => i.key === 'prompt')?.type).toBe('text')
    // Keys set explicitly are respected, and still reported if they clash.
    const clash = buildSchema(t2v(), { inputs: { int: { hidden: false, key: 'x' }, 'int#2': { hidden: false, key: 'x' } } }, objectInfo)
    expect(clash.duplicateKeys).toEqual(['x'])
  })

  it('takes defaults from the overrides', () => {
    const ov = { inputs: { duration: { default: 8 }, megapixels: { default: 0.5 } }, expose: [{ class: 'ResolutionSelector', field: 'multiple', default: 16 }] }
    const s = buildSchema(r2v(), ov, objectInfo)
    const def = (k: string): unknown => s.inputs.find((i) => i.key === k)?.default
    expect([def('duration'), def('megapixels'), def('multiple')]).toEqual([8, 0.5, 16])
    expect(def('aspect_ratio')).toBe('2:3 (Portrait Photo)')
    // Used when the shot has no value of its own; a value in the shot still wins.
    expect(applyValues(r2v(), s, {})['115'].inputs).toMatchObject({ megapixels: 0.5, multiple: 16 })
    expect(applyValues(r2v(), s, { megapixels: 2 })['115'].inputs.megapixels).toBe(2)
  })

  it('empty frames turn fl2v into t2v', () => {
    const s = buildSchema(fl2v(), null, objectInfo)
    const out = applyValues(fl2v(), s, { first_frame: null, last_frame: '' })
    expect(out['114']).toBeUndefined()
    expect(out['794']).toBeUndefined()
    expect(out['105:104'].inputs.first_frame).toBeUndefined()
    expect(out['105:104'].inputs.last_frame).toBeUndefined()
    // Same graph as the t2v export, apart from ids prefix and defaults.
    expect(Object.keys(out).length).toBe(Object.keys(t2v()).length)
  })

  it('resizes ref image groups contiguously', () => {
    const wf = r2v()
    const s = buildSchema(wf, null, objectInfo)
    const fewer = applyValues(wf, s, { ref_images: ['a.png', 'b.png'] }, { seed: 7 })
    const refKeys = Object.keys(fewer['136'].inputs).filter((k) => k.startsWith('ref_images.'))
    expect(refKeys).toEqual(['ref_images.ref_image_0', 'ref_images.ref_image_1'])
    expect(fewer['137'].inputs.image).toBe('a.png')
    expect(fewer['149'].inputs.image).toBe('b.png')
    expect(fewer['147']).toBeUndefined()
    expect(fewer['129'].inputs.noise_seed).toBe(7)
    const more = applyValues(wf, s, { ref_images: ['1', '2', '3', '4', '5', '6', '7', '8'] })
    const moreKeys = Object.keys(more['136'].inputs).filter((k) => k.startsWith('ref_images.'))
    expect(moreKeys).toHaveLength(8)
    const lastId = (more['136'].inputs['ref_images.ref_image_7'] as [string, number])[0]
    expect(more[lastId].class_type).toBe('LoadImage')
    expect(more[lastId].inputs.image).toBe('8')
    // Template untouched
    expect(Object.keys(wf['136'].inputs).filter((k) => k.startsWith('ref_images.'))).toHaveLength(6)
  })

  it('validates', () => {
    const s = buildSchema(r2v(), null, objectInfo)
    const errs = validateValues(s.inputs, { prompt: 'x', duration: 5, ref_images: [], aspect_ratio: 'nope' })
    expect(Object.keys(errs).sort()).toEqual(['aspect_ratio', 'ref_images'])
  })

  it('diffs versions by key', () => {
    const a = buildSchema(r2v(), null, objectInfo).inputs
    const wf = r2v()
    delete wf['146']
    wf['141'].inputs.switch = true
    wf['142'].inputs.switch = true
    const b = buildSchema(wf, null, objectInfo).inputs
    const d = diffSchemas(a, b)
    expect(d.removed.map((i) => i.key)).toEqual(['enable lightning lora'])
    expect(d.same.map((i) => i.key)).toEqual(['prompt', 'aspect_ratio', 'megapixels', 'duration', 'ref_images'])
  })

  it('checks against the server', () => {
    const c = checkWorkflow(r2v(), objectInfo)
    expect(c.missingNodeTypes.length).toBeGreaterThan(0)
    expect(c.models.length).toBe(5)
    expect(c.brokenLinks).toEqual([])
  })
})
