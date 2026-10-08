/** Run planner: expands prompts x runs into one job per attempt. */

export type SeedMode = 'random' | 'fixed'

export interface PlanInput {
  /** null = single prompt mode (the prompt stays in the value map). */
  prompts: string[] | null
  runs: number
  seedMode: SeedMode
  fixedSeed: number | null
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

export function randomSeed(random: () => number = Math.random): number {
  return Math.floor(random() * MAX_SEED)
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
        seed: p.seedMode === 'fixed' && p.fixedSeed !== null ? p.fixedSeed : randomSeed(p.random)
      })
    }
  })
  return jobs
}

export function jobCount(prompts: number, runs: number): number {
  return Math.max(0, prompts) * Math.max(1, Math.floor(runs || 1))
}
