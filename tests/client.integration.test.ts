import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { ComfyClient, ComfyError, historyFiles, type WsMessage } from '../src/core/comfy/client'
import { applyValues, buildSchema } from '../src/core/workflow'
import { r2v, fl2v } from './fixtures'

const PORT = 18000 + Math.floor(Math.random() * 1000)
let proc: ChildProcess

beforeAll(async () => {
  proc = spawn(process.execPath, [resolve(__dirname, '../scripts/fake-comfy.mjs')], { env: { ...process.env, PORT: String(PORT), STEP_MS: '20' } })
  await new Promise<void>((ok) => proc.stdout!.on('data', (d) => String(d).includes('fake ComfyUI') && ok()))
}, 60_000)
afterAll(() => proc?.kill())

const waitFor = (client: ComfyClient, pid: string, type: string): Promise<WsMessage[]> =>
  new Promise((ok) => {
    const seen: WsMessage[] = []
    client.on('message', (m: WsMessage) => {
      if (m.data?.prompt_id !== pid) return
      seen.push(m)
      if (m.type === type) ok(seen)
    })
  })

describe('ComfyClient against the fake server', () => {
  it('uploads, queues, follows progress, downloads', async () => {
    const client = new ComfyClient({ baseUrl: `127.0.0.1:${PORT}`, clientId: 'test-client' })
    const oi = await client.objectInfo()
    const schema = buildSchema(r2v(), { expose: [{ class: 'ResolutionSelector', field: 'aspect_ratio' }] }, oi)
    expect(schema.inputs.find((i) => i.key === 'aspect_ratio')?.constraints.options?.length).toBe(5)
    const up = await client.uploadImage('abc.png', new Uint8Array([1, 2, 3]))
    expect(up.name).toBe('abc.png')
    client.connect()
    await new Promise((ok) => client.once('open', ok))
    const final = applyValues(r2v(), schema, { prompt: 'hello', ref_images: ['abc.png'] }, { seed: 4 })
    const { prompt_id } = await client.queuePrompt(final)
    const msgs = await waitFor(client, prompt_id, 'execution_success')
    expect(msgs.some((m) => m.type === 'progress')).toBe(true)
    const h = await client.getHistory(prompt_id)
    const files = historyFiles(h!)
    expect(files).toHaveLength(1)
    const data = await client.view(files[0])
    expect(data.byteLength).toBeGreaterThan(0)

    // Identical prompt + seed: served from cache
    const again = await client.queuePrompt(final)
    const msgs2 = await waitFor(client, again.prompt_id, 'execution_success')
    const cached = msgs2.find((m) => m.type === 'execution_cached')
    expect((cached!.data.nodes as string[]).length).toBe(Object.keys(final).length)
    client.disconnect()
  }, 30_000)

  it('reports rejected prompts with node errors', async () => {
    const client = new ComfyClient({ baseUrl: `http://127.0.0.1:${PORT}`, clientId: 'x' })
    const wf = fl2v()
    const schema = buildSchema(wf, null, await client.objectInfo())
    const final = applyValues(wf, schema, { first_frame: 'missing.png' })
    const err = await client.queuePrompt(final).catch((e) => e)
    expect(err).toBeInstanceOf(ComfyError)
    expect(Object.keys((err as ComfyError).body as object)).toContain('node_errors')
  })
})
