import { describe, expect, it } from 'vitest'
import { planRun } from '../src/core/planner'
import { renderTemplate, templateSlots } from '../src/core/prompter/template'
import { attemptFileName, freeFileName, safeName, shotOutputDir } from '../src/core/output/naming'
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
    expect(attemptFileName(6, 'ref2vid', 'MP4')).toBe('attempt-6-ref2vid.mp4')
  })

  it('never reuses a file name that is taken', () => {
    const taken = new Set(['attempt-6-ref2vid.mp4', 'attempt-6-ref2vid (2).mp4'])
    expect(freeFileName('attempt-7-ref2vid.mp4', (n) => taken.has(n))).toBe('attempt-7-ref2vid.mp4')
    expect(freeFileName('attempt-6-ref2vid.mp4', (n) => taken.has(n))).toBe('attempt-6-ref2vid (3).mp4')
  })
})
