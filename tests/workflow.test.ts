import { describe, expect, it } from 'vitest'
import { applyValues, buildSchema, checkWorkflow, detectFormat, diffSchemas, graphModel, graphSteps, keyFromTitle, validateValues } from '../src/core/workflow'
import type { ApiWorkflow } from '../src/core/workflow/types'
import { fl2v, numzUpscale, objectInfo, r2v, seedvr2Upscale, t2v } from './fixtures'

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
      expect(r.nodeCount).toBe(31)
      expect(r.nodeTypeCount).toBe(25)
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
    expect(keys).toEqual(['prompt', 'lora', 'aspect_ratio', 'megapixels', 'duration', 'lora_strength', 'enable lightning lora', 'ref_images', 'ref_videos', 'ref_audios'])
    expect(s.inputs.find((i) => i.key === 'aspect_ratio')?.type).toBe('select')
    const group = s.inputs.find((i) => i.key === 'ref_images')!
    expect(group.type).toBe('file-group')
    expect(group.constraints.maxCount).toBe(9)
    expect(group.constraints.minCount).toBe(1)
    if (group.target.kind === 'file-group') expect(group.target.slots.map((x) => x.nodeId)).toEqual(['137', '149', '147', '148'])
    // Steps primitives only feed switches: discovered but hidden by default
    expect(s.discovery.candidates.filter((c) => !c.defaultExposed && c.nodeClass.startsWith('Primitive')).map((c) => c.id)).toEqual(['full', 'lightning lora'])
    // Model, sampler and scheduler are recognised but start unticked; the Lightning LoRA is a LoRA like the others, fps is derived in the graph.
    expect(s.discovery.candidates.filter((c) => !c.defaultExposed && !c.nodeClass.startsWith('Primitive')).map((c) => c.id).sort()).toEqual(
      ['denoise', 'fps', 'sampler', 'scheduler', 'unet', 'vae', 'vae#2', 'clip'].sort()
    )
    expect(s.seedTargets).toEqual([{ nodeId: '129', field: 'noise_seed', max: 18446744073709551615 }])
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
    expect(Object.keys(byKey).sort()).toEqual(['aspect_ratio', 'duration', 'enable lightning lora', 'first_frame', 'last_frame', 'lora', 'lora_strength', 'megapixels', 'prompt'])
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
    expect(Object.keys(wf['136'].inputs).filter((k) => k.startsWith('ref_images.'))).toHaveLength(4)
  })

  it('discovers video and audio references', () => {
    const s = buildSchema(r2v(), null, objectInfo)
    const videos = s.inputs.find((i) => i.key === 'ref_videos')!
    expect(videos.type).toBe('file-group')
    expect(videos.constraints).toMatchObject({ media: 'video', required: false, minCount: 0, maxCount: 3 })
    // The loader is found through Get Video Components, whose audio output fills a slot group of its own.
    expect(videos.target).toMatchObject({
      field: 'file',
      output: 0,
      slots: [{ nodeId: '154', via: '160', input: 'ref_videos.ref_video_0' }],
      also: [{ prefix: 'ref_video_audios', base: 'ref_video_audio_', output: 1 }]
    })
    const audios = s.inputs.find((i) => i.key === 'ref_audios')!
    expect(audios.constraints).toMatchObject({ media: 'audio', maxCount: 3 })
    expect(audios.target).toMatchObject({ field: 'audio', slots: [{ nodeId: '155', input: 'ref_audios.ref_audio_0' }] })
    expect(s.inputs.find((i) => i.key === 'ref_images')?.constraints.media).toBe('image')
    // The loaders' own fields are not offered as plain fields to expose.
    expect(s.discovery.fields.some((f) => ['LoadVideo', 'LoadAudio', 'GetVideoComponents'].includes(f.nodeClass))).toBe(false)
  })

  it('leaves out unused video and audio references', () => {
    const wf = r2v()
    const s = buildSchema(wf, null, objectInfo)
    const none = applyValues(wf, s, { ref_images: ['a.png'] })
    expect(Object.keys(none['136'].inputs).filter((k) => !k.startsWith('ref_images.') && k.includes('.'))).toEqual([])
    expect(Object.values(none).some((n) => ['LoadVideo', 'LoadAudio', 'GetVideoComponents'].includes(n.class_type))).toBe(false)
  })

  it('wires each video reference with its audio track', () => {
    const wf = r2v()
    const s = buildSchema(wf, null, objectInfo)
    const out = applyValues(wf, s, { ref_images: ['a.png'], ref_videos: ['v1.mp4', 'v2.mp4'], ref_audios: ['s.wav'] })
    const inputs = out['136'].inputs
    expect(out['154'].inputs.file).toBe('v1.mp4')
    expect(inputs['ref_videos.ref_video_0']).toEqual(['160', 0])
    expect(inputs['ref_video_audios.ref_video_audio_0']).toEqual(['160', 1])
    // The second video gets its own loader and unpack node, cloned from the first.
    const [unpack, output] = inputs['ref_videos.ref_video_1'] as [string, number]
    expect(output).toBe(0)
    expect(unpack).not.toBe('160')
    expect(out[unpack].class_type).toBe('GetVideoComponents')
    expect(inputs['ref_video_audios.ref_video_audio_1']).toEqual([unpack, 1])
    const loader = (out[unpack].inputs.video as [string, number])[0]
    expect(loader).not.toBe('154')
    expect(out[loader]).toMatchObject({ class_type: 'LoadVideo', inputs: { file: 'v2.mp4' } })
    expect(out['155'].inputs.audio).toBe('s.wav')
    expect(inputs['ref_audios.ref_audio_0']).toEqual(['155', 0])
    expect(validateValues(s.inputs, { ref_images: ['a.png'], ref_videos: ['1', '2', '3', '4'] }).ref_videos).toBe('At most 3 videos. Remove 1.')
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
    expect(d.same.map((i) => i.key)).toEqual(['prompt', 'lora', 'aspect_ratio', 'megapixels', 'duration', 'lora_strength', 'ref_images', 'ref_videos', 'ref_audios'])
  })

  it('checks against the server', () => {
    const c = checkWorkflow(r2v(), objectInfo)
    expect(c.missingNodeTypes.length).toBeGreaterThan(0)
    expect(c.models.length).toBe(5)
    expect(c.brokenLinks).toEqual([])
  })
})

describe('seedvr2 upscale', () => {
  it('exposes the video, trim and scale by default and drives the seed', () => {
    const s = buildSchema(seedvr2Upscale(), null, null)
    expect(s.inputs.map((i) => i.key)).toEqual(['cfg', 'denoise', 'scale_multiplier', 'trim_video', 'split latent', 'video'])
    const byKey = Object.fromEntries(s.inputs.map((i) => [i.key, i]))
    expect(byKey.trim_video).toMatchObject({ type: 'toggle', label: 'Trim video', default: false, target: { kind: 'field', nodeId: '66:81', field: 'switch' } })
    expect(byKey.scale_multiplier).toMatchObject({ type: 'number', label: 'Scale multiplier', default: 1.5, target: { kind: 'field', nodeId: '66:57', field: 'resize_type.multiplier' } })
    expect(byKey.denoise).toMatchObject({ type: 'number', default: 1, constraints: { min: 0, max: 1 }, target: { kind: 'field', nodeId: '66:54', field: 'denoise' } })
    expect(byKey.cfg).toMatchObject({ type: 'number', default: 1, target: { kind: 'field', nodeId: '66:54', field: 'cfg' } })
    expect(s.discovery.fields.map((f) => f.field)).not.toContain('denoise')
    expect(byKey.video.type).toBe('file')
    expect(byKey.video.constraints.media).toBe('video')
    for (const k of ['scale_multiplier', 'trim_video', 'cfg', 'denoise']) expect(byKey[k].tooltip, k).toMatch(/\S/)
    expect(s.seedTargets).toEqual([{ nodeId: '66:54', field: 'seed' }])
    expect(s.duplicateKeys).toEqual([])
    expect(byKey['split latent']).toMatchObject({ type: 'toggle', default: false })
    expect(byKey['split latent'].tooltip).toMatch(/chunks/)
  })

  it('writes the trim switch, scale and seed into the graph', () => {
    const wf = seedvr2Upscale()
    const s = buildSchema(wf, null, null)
    const out = applyValues(wf, s, { trim_video: true, scale_multiplier: 2, denoise: 0.6, cfg: 1.5, video: 'clip.mp4' }, { seed: 7 })
    expect(out['66:81'].inputs.switch).toBe(true)
    expect(out['66:57'].inputs['resize_type.multiplier']).toBe(2)
    expect(out['73'].inputs.file).toBe('clip.mp4')
    expect(out['66:54'].inputs).toMatchObject({ seed: 7, denoise: 0.6, cfg: 1.5 })
  })
})

describe('seedvr2 upscale (numz nodes)', () => {
  it('exposes the settings that shape the result, and the video as `video`', () => {
    const s = buildSchema(numzUpscale(), null, null)
    expect(s.inputs.map((i) => i.key)).toEqual([
      'model', 'offload_device', 'resolution', 'batch_size', 'color_correction', 'temporal_overlap', 'input_noise_scale', 'latent_noise_scale',
      'blocks_to_swap', 'encode_tiled', 'decode_tiled', 'video'
    ])
    const byKey = Object.fromEntries(s.inputs.map((i) => [i.key, i]))
    expect(byKey.color_correction).toMatchObject({ type: 'select', default: 'lab' })
    expect(byKey.color_correction.constraints.options).toContain('wavelet')
    expect(byKey.batch_size).toMatchObject({ type: 'number', default: 33, constraints: { min: 1, step: 4, integer: true } })
    expect(byKey.video).toMatchObject({ type: 'file', constraints: { media: 'video' }, target: { kind: 'file', nodeId: '21', via: '22' } })
    for (const k of ['model', 'resolution', 'batch_size', 'color_correction', 'temporal_overlap', 'input_noise_scale', 'latent_noise_scale', 'offload_device', 'blocks_to_swap', 'encode_tiled', 'decode_tiled']) expect(byKey[k].tooltip, k).toMatch(/Start with/)
    expect(s.seedTargets).toEqual([{ nodeId: '10', field: 'seed' }])
    // The server's own limit (this node takes 32-bit seeds) is kept with the target.
    const limited = buildSchema(numzUpscale(), null, { SeedVR2VideoUpscaler: { input: { required: { seed: ['INT', { min: 0, max: 4294967295 }] } } } })
    expect(limited.seedTargets).toEqual([{ nodeId: '10', field: 'seed', max: 4294967295 }])
    expect(byKey.model.default).toBe('seedvr2_ema_7b_fp16.safetensors')
    expect(byKey.blocks_to_swap).toMatchObject({ type: 'number', default: 32, constraints: { min: 0, max: 36, integer: true } })
    expect(byKey.offload_device).toMatchObject({ default: 'none', target: { kind: 'field', nodeId: '14', field: 'offload_device' } })
    expect(byKey.encode_tiled).toMatchObject({ type: 'toggle', default: true })
    expect(byKey.decode_tiled).toMatchObject({ type: 'toggle', default: true })
    // The VAE's own `model` is not an input, and the other memory and speed settings stay fields to expose by hand.
    expect(s.inputs.filter((i) => i.key.startsWith('model'))).toHaveLength(1)
    expect(s.discovery.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['max_resolution', 'attention_mode']))
    expect(s.duplicateKeys).toEqual([])
  })

  it('shares the video key with the built-in nodes workflow, so a chosen video carries over', () => {
    const a = buildSchema(seedvr2Upscale(), null, null).inputs.find((i) => i.type === 'file')
    const b = buildSchema(numzUpscale(), null, null).inputs.find((i) => i.type === 'file')
    expect(a?.key).toBe('video')
    expect(b?.key).toBe('video')
  })

  it('writes the values into the graph', () => {
    const wf = numzUpscale()
    const s = buildSchema(wf, null, null)
    const out = applyValues(wf, s, { resolution: 1440, batch_size: 5, color_correction: 'wavelet', video: 'clip.mp4' }, { seed: 9 })
    expect(out['10'].inputs).toMatchObject({ resolution: 1440, batch_size: 5, color_correction: 'wavelet', seed: 9, temporal_overlap: 3 })
    expect(out['21'].inputs.file).toBe('clip.mp4')
  })
})

describe('graphModel', () => {
  it('reads the file name of the diffusion model loader', () => {
    expect(graphModel({ a: { class_type: 'UNETLoader', inputs: { unet_name: 'm.safetensors', weight_dtype: 'default' } } })).toBe('m.safetensors')
    expect(graphModel({ a: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'c.ckpt' } } })).toBe('c.ckpt')
    expect(graphModel(fl2v())).toMatch(/\.safetensors$/)
  })

  it('gives up when there is no loader or the name is a link', () => {
    expect(graphModel({})).toBeNull()
    expect(graphModel({ a: { class_type: 'UNETLoader', inputs: { unet_name: ['b', 0] } }, b: { class_type: 'Other', inputs: {} } })).toBeNull()
  })
})

describe('graphSteps', () => {
  it('follows the steps switch to the branch the turbo toggle selects', () => {
    const wf = fl2v()
    const sw = Object.values(wf).find((n) => n._meta?.title === 'Boolean (Enable Lightning LoRA)')!
    sw.inputs.value = true
    expect(graphSteps(wf)).toBe(8)
    sw.inputs.value = false
    expect(graphSteps(wf)).toBe(20)
  })

  it('gives up when a switch selector cannot be resolved', () => {
    const wf = fl2v()
    const sw = Object.values(wf).find((n) => n.class_type === 'ComfySwitchNode' && n._meta?.title === 'If/Else Switch (Steps)')!
    sw.inputs.switch = ['unknown', 0]
    expect(graphSteps(wf)).toBeNull()
  })

  it('reads a plain number and gives up on an unresolvable link', () => {
    expect(graphSteps({ a: { class_type: 'KSampler', inputs: { steps: 12 } } })).toBe(12)
    expect(graphSteps({ a: { class_type: 'KSampler', inputs: { steps: ['b', 0] } }, b: { class_type: 'Other', inputs: {} } })).toBeNull()
    expect(graphSteps({})).toBeNull()
  })
})

const sdWorkflow = (): ApiWorkflow => ({
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd15.safetensors' } },
  '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['1', 1] } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['1', 1] } },
  '4': { class_type: 'LoadImage', _meta: { title: 'Load Image' }, inputs: { image: 'in.png' } },
  '5': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } },
  '6': { class_type: 'SetLatentNoiseMask', inputs: { samples: ['5', 0], mask: ['4', 1] } },
  '7': { class_type: 'LoraLoader', inputs: { lora_name: 'a.safetensors', strength_model: 0.8, strength_clip: 0.8, model: ['1', 0], clip: ['1', 1] } },
  '8': { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['2', 0], negative: ['3', 0], strength: 1, start_percent: 0, end_percent: 1 } },
  '9': {
    class_type: 'KSampler',
    inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 0.75, model: ['7', 0], positive: ['8', 0], negative: ['8', 1], latent_image: ['6', 0] }
  },
  '10': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768, batch_size: 1 } },
  '11': { class_type: 'SaveImage', inputs: { filename_prefix: 'out', images: ['9', 0] } }
})

describe('core nodes', () => {
  it('exposes the creative fields of standard nodes with keys from their role in the graph', () => {
    const s = buildSchema(sdWorkflow(), null, null)
    const byKey = Object.fromEntries(s.inputs.map((i) => [i.key, i]))
    expect(Object.keys(byKey).sort()).toEqual(
      ['cfg', 'controlnet_strength', 'denoise', 'height', 'image', 'latent_batch', 'lora', 'lora_strength', 'negative prompt', 'prompt', 'steps', 'width'].sort()
    )
    expect(byKey.prompt).toMatchObject({ type: 'text', label: 'Prompt', default: 'a cat', constraints: { multiline: true }, target: { kind: 'field', nodeId: '2', field: 'text' } })
    expect(byKey['negative prompt']).toMatchObject({ label: 'Negative prompt', default: 'blurry', target: { kind: 'field', nodeId: '3', field: 'text' } })
    expect(s.duplicateKeys).toEqual([])
    expect(s.seedTargets).toEqual([{ nodeId: '9', field: 'seed' }])
    // The mask output of the loader does not name the file; the image output does.
    expect(byKey.image).toMatchObject({ type: 'file', source: expect.stringContaining('pixels') })
  })

  it('recognises model, sampler and scheduler but leaves them unticked', () => {
    const s = buildSchema(sdWorkflow(), null, null)
    const off = s.discovery.candidates.filter((c) => !c.defaultExposed).map((c) => c.id)
    expect(off).toEqual(expect.arrayContaining(['checkpoint', 'lora_clip_strength', 'sampler', 'scheduler', 'controlnet_start', 'controlnet_end']))
    // Ticking one through overrides adds it as an input.
    const on = buildSchema(sdWorkflow(), { inputs: { sampler: { hidden: false } } }, null)
    expect(on.inputs.find((i) => i.key === 'sampler')).toMatchObject({ default: 'euler', target: { kind: 'field', nodeId: '9', field: 'sampler_name' } })
    expect(s.discovery.fields.map((f) => f.field)).not.toContain('sampler_name')
  })

  it('writes the values into the nodes they belong to', () => {
    const wf = sdWorkflow()
    const s = buildSchema(wf, null, null)
    const out = applyValues(wf, s, { prompt: 'a dog', 'negative prompt': 'ugly', steps: 30, width: 1024, latent_batch: 2, lora_strength: 0.5 })
    expect(out['2'].inputs.text).toBe('a dog')
    expect(out['3'].inputs.text).toBe('ugly')
    expect(out['9'].inputs.steps).toBe(30)
    expect(out['10'].inputs).toMatchObject({ width: 1024, height: 768, batch_size: 2 })
    expect(out['7'].inputs.strength_model).toBe(0.5)
  })

  it('finds the positive prompt of a guided (Flux) graph and falls back to the title when no sampler is wired', () => {
    const flux: ApiWorkflow = {
      '1': { class_type: 'CLIPTextEncodeFlux', inputs: { clip_l: 'tags', t5xxl: 'a long sentence', guidance: 3.5 } },
      '2': { class_type: 'FluxGuidance', inputs: { guidance: 3.5, conditioning: ['1', 0] } },
      '3': { class_type: 'BasicGuider', inputs: { conditioning: ['2', 0] } },
      '4': { class_type: 'CLIPTextEncode', _meta: { title: 'Style Note' }, inputs: { text: 'film grain' } }
    }
    const s = buildSchema(flux, null, null)
    expect(s.inputs.map((i) => i.key).sort()).toEqual(['guidance', 'guidance#2', 'prompt', 'prompt clip_l', 'style note'].sort())
    expect(s.inputs.find((i) => i.key === 'prompt')?.target).toMatchObject({ nodeId: '1', field: 't5xxl' })
  })

  it('recognises the size of every video latent node the same way', () => {
    const wf: ApiWorkflow = {
      '1': { class_type: 'WanAnimateToVideo', inputs: { width: 832, height: 480, length: 81, batch_size: 1, continue_motion_max_frames: 5 } },
      '2': { class_type: 'EmptyFlux2LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } }
    }
    expect(buildSchema(wf, null, null).inputs.map((i) => i.key).sort()).toEqual(['height', 'height#2', 'latent_batch', 'latent_batch#2', 'length', 'width', 'width#2'].sort())
  })

  it('says which node each input belongs to', () => {
    const own = (wf: ApiWorkflow, id: string) => buildSchema(wf, null, null).discovery.candidates.find((c) => c.id === id)?.owner
    // A field belongs to its node; a loaded file to the node that consumes it.
    expect(own(sdWorkflow(), 'prompt')).toEqual({ nodeId: '2', title: 'CLIPTextEncode', nodeClass: 'CLIPTextEncode' })
    expect(own(sdWorkflow(), 'image')).toMatchObject({ nodeId: '5', nodeClass: 'VAEEncode' })
    expect(own(sdWorkflow(), 'steps')).toMatchObject({ nodeId: '9', nodeClass: 'KSampler' })
    expect(own(r2v(), 'ref_images')).toMatchObject({ nodeId: '136', nodeClass: 'MiniMaxH3ReferenceToVideo' })
    // A control node is the input itself, so it has no owner.
    expect(own(r2v(), 'duration')).toBeUndefined()
    // The source text names the node and field without the value at import time.
    const f = buildSchema(sdWorkflow(), null, null).discovery.fields.find((x) => x.field === 'channel' || x.field === 'filename_prefix')
    expect(f?.source).not.toContain('=')
  })

  it('exposes a LoRA behind a toggle like any other', () => {
    const wf = sdWorkflow()
    wf['19'] = { class_type: 'PrimitiveBoolean', _meta: { title: 'Boolean (Enable LoRA)' }, inputs: { value: true } }
    wf['20'] = { class_type: 'ComfySwitchNode', inputs: { switch: ['19', 0], on_true: ['7', 0], on_false: ['1', 0] } }
    expect(buildSchema(wf, null, null).inputs.map((i) => i.key)).toEqual(expect.arrayContaining(['enable lora', 'lora', 'lora_strength']))
  })

  it('exposes the name and strength of every LoRA in a chain, in chain order, also behind a toggle', () => {
    const wf: ApiWorkflow = {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: 'm.safetensors' } },
      // The chain runs 9, 3, 6: node order says otherwise.
      '9': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: 'first', strength_model: 1 } },
      '3': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['9', 0], lora_name: 'second', strength_model: 0 } },
      '6': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['3', 0], lora_name: 'third', strength_model: 0 } },
      '5': { class_type: 'PrimitiveBoolean', _meta: { title: 'Boolean (Enable LoRA)' }, inputs: { value: true } },
      '7': { class_type: 'ComfySwitchNode', inputs: { switch: ['5', 0], on_true: ['6', 0], on_false: ['1', 0] } }
    }
    const s = buildSchema(wf, null, null)
    const byKey = Object.fromEntries(s.inputs.map((i) => [i.key, i]))
    expect(Object.keys(byKey).sort()).toEqual(['enable lora', 'lora', 'lora_2', 'lora_3', 'lora_strength', 'lora_strength_2', 'lora_strength_3'].sort())
    expect([byKey.lora.default, byKey.lora_2.default, byKey.lora_3.default]).toEqual(['first', 'second', 'third'])
    expect(byKey.lora_strength_2).toMatchObject({ label: 'LoRA strength 2', target: { nodeId: '3', field: 'strength_model' } })
    expect(s.duplicateKeys).toEqual([])
  })
})
