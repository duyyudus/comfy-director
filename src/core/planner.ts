/** Run planner: expands prompts x runs into one job per attempt. */

export type SeedMode = 'random' | 'fixed'

export interface PlanInput {
  /** null = single prompt mode (the prompt stays in the value map). */
  prompts: string[] | null
  runs: number
  seedMode: SeedMode
  fixedSeed: number | null
  /** Random seeds are below this (see `seedLimit`). */
  seedLimit?: number
  random?: () => number
}

export interface PlannedJob {
  index: number
  prompt: string | null
  promptIndex: number
  promptCount: number
  runIndex: number
  seed: number
}

export const MAX_SEED = 2 ** 48

export function randomSeed(random: () => number = Math.random, limit: number = MAX_SEED): number {
  return Math.floor(random() * limit)
}

/** Random seeds stay below this: the app's own range, or less when a seed field on the workflow takes a smaller maximum. */
export function seedLimit(targets: { max?: number }[]): number {
  return targets.reduce((limit, t) => (t.max !== undefined && t.max >= 0 ? Math.min(limit, t.max + 1) : limit), MAX_SEED)
}

export function planRun(p: PlanInput): PlannedJob[] {
  const prompts = p.prompts ?? [null]
  const runs = Math.max(1, Math.floor(p.runs || 1))
  const jobs: PlannedJob[] = []
  prompts.forEach((prompt, promptIndex) => {
    for (let runIndex = 0; runIndex < runs; runIndex++) {
      jobs.push({
        index: jobs.length,
        prompt,
        promptIndex,
        promptCount: prompts.length,
        runIndex,
        seed: p.seedMode === 'fixed' && p.fixedSeed !== null ? p.fixedSeed : randomSeed(p.random, p.seedLimit)
      })
    }
  })
  return jobs
}

export function jobCount(prompts: number, runs: number): number {
  return Math.max(0, prompts) * Math.max(1, Math.floor(runs || 1))
}
