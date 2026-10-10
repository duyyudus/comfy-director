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
    const schema = buildSchema(r2v(), null, oi)
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

  it('lists and deletes server files through the companion node routes', async () => {
    const client = new ComfyClient({ baseUrl: `127.0.0.1:${PORT}`, clientId: 'files' })
    await client.uploadImage('to-delete.png', new Uint8Array([1, 2, 3, 4]))
    const before = await client.listFiles('input')
    const file = before.find((f) => f.filename === 'to-delete.png')
    expect(file).toMatchObject({ subfolder: '', type: 'input', size: 4 })
    expect(Math.abs(Date.now() - file!.modified)).toBeLessThan(60_000)
    const thumb = await client.thumbResponse(file!, 160)
    expect(thumb.status).toBe(200)
    expect(thumb.headers.get('content-type')).toBe('image/png')
    await client.uploadImage('notes.txt', new Uint8Array([1]))
    expect((await client.thumbResponse({ filename: 'notes.txt', subfolder: '', type: 'input' }, 160)).status).toBe(404)

    const res = await client.deleteFiles([file!, { filename: 'fake-comfy.mjs', subfolder: '../../..', type: 'input' }])
    expect(res.deleted).toEqual([{ filename: 'to-delete.png', subfolder: '', type: 'input' }])
    expect(res.errors).toHaveLength(1)
    expect((await client.listFiles('input')).some((f) => f.filename === 'to-delete.png')).toBe(false)
  })

  it('renders again after its cached output was deleted', async () => {
    const client = new ComfyClient({ baseUrl: `127.0.0.1:${PORT}`, clientId: 'recache' })
    const schema = buildSchema(r2v(), null, await client.objectInfo())
    await client.uploadImage('recache.png', new Uint8Array([1]))
    client.connect()
    await new Promise((ok) => client.once('open', ok))
    const final = applyValues(r2v(), schema, { prompt: 'delete then rerun', ref_images: ['recache.png'] }, { seed: 11 })
    const first = await client.queuePrompt(final)
    await waitFor(client, first.prompt_id, 'execution_success')
    const [file] = historyFiles((await client.getHistory(first.prompt_id))!)
    const res = await client.deleteFiles([{ ...file, type: 'output' }])
    expect(res.deleted).toHaveLength(1)

    const again = await client.queuePrompt(final)
    const msgs = await waitFor(client, again.prompt_id, 'execution_success')
    expect(msgs.find((m) => m.type === 'execution_cached')!.data.nodes).toEqual([])
    const [fresh] = historyFiles((await client.getHistory(again.prompt_id))!)
    expect((await client.view(fresh)).byteLength).toBeGreaterThan(0)
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
