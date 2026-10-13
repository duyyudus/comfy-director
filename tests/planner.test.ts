import { describe, expect, it } from 'vitest'
import { planRun, seedLimit } from '../src/core/planner'
import { renderTemplate, templateSlots } from '../src/core/prompter/template'
import { checkOutputTemplate, DEFAULT_OUTPUT_TEMPLATE, freeFileName, LEGACY_OUTPUT_TEMPLATE, outputFileName, renderOutputName, safeName, shotOutputDir, type OutputNameContext } from '../src/core/output/naming'
import { setOutputPrefix } from '../src/core/workflow/apply'
import type { ApiWorkflow } from '../src/core/workflow/types'
import { parseScriptOutput } from '../src/core/prompter/script'

describe('planner', () => {
  it('expands prompts x runs', () => {
    const jobs = planRun({ prompts: ['a', 'b', 'c'], runs: 2, seedMode: 'random', fixedSeed: null })
    expect(jobs).toHaveLength(6)
    expect(jobs.map((j) => j.prompt)).toEqual(['a', 'a', 'b', 'b', 'c', 'c'])
    expect(new Set(jobs.map((j) => j.seed)).size).toBe(6)
  })
  it('uses the fixed seed', () => {
    const jobs = planRun({ prompts: null, runs: 3, seedMode: 'fixed', fixedSeed: 42 })
    expect(jobs.map((j) => j.seed)).toEqual([42, 42, 42])
    expect(jobs[0].prompt).toBeNull()
  })
})

describe('seed limit', () => {
  it('keeps random seeds inside the smallest maximum a seed field takes', () => {
    expect(seedLimit([])).toBe(2 ** 48)
    expect(seedLimit([{}, { max: 2 ** 64 }])).toBe(2 ** 48)
    expect(seedLimit([{ max: 4294967295 }, { max: 100 }])).toBe(101)
    const jobs = planRun({ prompts: null, runs: 200, seedMode: 'random', fixedSeed: null, seedLimit: seedLimit([{ max: 4294967295 }]) })
    expect(Math.max(...jobs.map((j) => j.seed))).toBeLessThanOrEqual(4294967295)
  })
})

describe('template prompter', () => {
  const cfg = {
    template: '{subject} stands at the {location}, {lighting}.',
    slots: {
      subject: { mode: 'random' as const, values: ['a courier', 'an old man', 'a woman in a red coat'] },
      location: { mode: 'order' as const, values: ['roof edge', 'water tower'] },
      lighting: { mode: 'same' as const, values: ['cold blue dusk light'] }
    },
    count: 4,
    seed: 48213,
    avoidRepeats: true
  }
  it('finds slots', () => expect(templateSlots(cfg.template)).toEqual(['subject', 'location', 'lighting']))
  it('is reproducible from the seed', () => {
    const a = renderTemplate(cfg, 4, 1)
    expect(renderTemplate(cfg, 4, 1)).toEqual(a)
    expect(a[0]).toMatch(/^[A-Z].* stands at the roof edge, cold blue dusk light\.$/)
    expect(a[1]).toContain('water tower')
  })
  it('parses script output', () => {
    expect(parseScriptOutput('["a", "b"]\n')).toEqual(['a', 'b'])
    expect(() => parseScriptOutput('nope')).toThrow()
  })
})

describe('naming', () => {
  it('makes safe paths', () => {
    expect(safeName('a/b:c?')).toBe('a_b_c_')
    expect(shotOutputDir({ name: 'Roof edge', position: 3 }, 'Rooftop chase')).toBe('outputs/Rooftop chase/03 Roof edge')
    expect(shotOutputDir({ name: 'Rain', position: null }, null)).toBe('outputs/_loose/Rain')
    expect(outputFileName('attempt-6-ref2vid', 'MP4')).toBe('attempt-6-ref2vid.mp4')
    expect(outputFileName('attempt-6-ref2vid', 'png', 1)).toBe('attempt-6-ref2vid-2.png')
  })

  const ctx: OutputNameContext = {
    attempt: 6, num: 2, shot: 'Roof edge', sequence: 'Rooftop chase', position: '03', workflow: 'ref2vid', seed: 99, date: '2026-10-13', time: '142530'
  }

  it('renders the output name template', () => {
    expect(renderOutputName(DEFAULT_OUTPUT_TEMPLATE, ctx)).toBe('Rooftop chase_Roof edge_attempt-2-ref2vid')
    expect(renderOutputName(DEFAULT_OUTPUT_TEMPLATE, { ...ctx, sequence: null, position: null })).toBe('Roof edge_attempt-2-ref2vid')
    expect(renderOutputName(LEGACY_OUTPUT_TEMPLATE, ctx)).toBe('attempt-6-ref2vid')
    expect(renderOutputName('{sequence}_{position}_{shot}_a{attempt}_{date}', ctx)).toBe('Rooftop chase_03_Roof edge_a6_2026-10-13')
    // Values are made safe, not the template's own separators.
    expect(renderOutputName('{shot}-{attempt}', { ...ctx, shot: 'a/b:c' })).toBe('a_b_c-6')
  })

  it('drops the parts a loose shot does not have', () => {
    expect(renderOutputName('{sequence}_{position}_{shot}_{attempt}', { ...ctx, sequence: null, position: null })).toBe('Roof edge_6')
  })

  it('checks the output name template', () => {
    expect(checkOutputTemplate(DEFAULT_OUTPUT_TEMPLATE)).toBeNull()
    expect(checkOutputTemplate('{shot}_{attempt}')).toBeNull()
    expect(checkOutputTemplate('')).toMatch(/Enter/)
    expect(checkOutputTemplate('{shot}_{nope}_{attempt}')).toMatch(/Unknown token \{nope\}/)
    expect(checkOutputTemplate('{shot}_{num}')).toBeNull()
    expect(checkOutputTemplate('{shot}_{seed}')).toMatch(/needs \{num\} or \{attempt\}/)
    expect(checkOutputTemplate('{shot_{attempt}')).not.toBeNull()
  })

  it('sets the prefix name on save nodes and keeps the server subfolder', () => {
    const wf: ApiWorkflow = {
      '1': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/ComfyUI', video: ['2', 0] } },
      '3': { class_type: 'SaveImage', inputs: { filename_prefix: 'frame', images: ['4', 0] } },
      '5': { class_type: 'SaveImage', inputs: { filename_prefix: ['6', 0], images: ['4', 0] } },
      '7': { class_type: 'KSampler', inputs: { seed: 1 } }
    }
    expect(setOutputPrefix(wf, 'attempt-6-ref2vid')).toBe(2)
    expect(wf['1'].inputs.filename_prefix).toBe('video/attempt-6-ref2vid')
    expect(wf['3'].inputs.filename_prefix).toBe('attempt-6-ref2vid')
    expect(wf['5'].inputs.filename_prefix).toEqual(['6', 0])
  })

  it('never reuses a file name that is taken', () => {
    const taken = new Set(['attempt-6-ref2vid.mp4', 'attempt-6-ref2vid (2).mp4'])
    expect(freeFileName('attempt-7-ref2vid.mp4', (n) => taken.has(n))).toBe('attempt-7-ref2vid.mp4')
    expect(freeFileName('attempt-6-ref2vid.mp4', (n) => taken.has(n))).toBe('attempt-6-ref2vid (3).mp4')
  })
})
