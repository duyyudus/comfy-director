import { spawn } from 'node:child_process'
import type { GenerateRequest, Prompter, ScriptConfig } from './types'

/**
 * Runs a user-chosen script as a child process: JSON on stdin ({count, seed, prompt}),
 * a JSON list of prompts on stdout. Runs with the user's own rights.
 */
export class ScriptPrompter implements Prompter {
  constructor(private cfg: ScriptConfig, private timeoutMs = 60_000) {}

  generate(req: GenerateRequest): Promise<string[]> {
    if (!this.cfg.path) return Promise.reject(new Error('Choose a script file first.'))
    const cmd = this.cfg.runtime === 'node' ? process.env.COMFY_DIRECTOR_NODE || 'node' : pythonCommand()
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, [this.cfg.path], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`The script did not finish within ${this.timeoutMs / 1000} s.`))
      }, this.timeoutMs)
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.stderr.on('data', (d: Buffer) => (err += d.toString()))
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new Error(`Could not start ${cmd}: ${e.message}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) return reject(new Error(`The script exited with code ${code}. ${err.trim().slice(0, 500)}`))
        try {
          resolve(parseScriptOutput(out))
        } catch (e) {
          reject(e)
        }
      })
      child.stdin.end(JSON.stringify({ count: req.count, seed: req.seed, prompt: req.currentPrompt }))
    })
  }
}

function pythonCommand(): string {
  return process.env.COMFY_DIRECTOR_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
}

export function parseScriptOutput(out: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(out.trim())
  } catch {
    throw new Error('The script did not print a JSON list on stdout.')
  }
  if (!Array.isArray(parsed)) throw new Error('The script output is not a JSON list.')
  return parsed.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).filter((p) => p.trim())
}
