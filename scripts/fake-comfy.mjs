#!/usr/bin/env node
/**
 * A small fake ComfyUI server for developing Comfy Director without a GPU.
 * Answers the routes the app uses (prompt, ws, history, view, upload, object_info, queue, interrupt)
 * with scripted scenarios. Put a keyword in the prompt text to pick one:
 *   #fail     execution error on the sampler        #oom     out of GPU memory
 *   #reject   POST /prompt rejected (field error)   #slow    slower sampling
 * Upload a file whose name contains "reject" to make the upload fail.
 * Extra routes: POST /_fake/other-client (queue a job from another client),
 *               POST /_fake/offline?seconds=10 (drop connections and refuse requests).
 * It also answers the companion node's routes (GET /comfy_director/files, GET /comfy_director/thumb,
 * POST /comfy_director/files/delete). A thumbnail is the image itself, or a video frame cut with ffmpeg.
 * Env: PORT (8188), FAKE_TOKEN (require "Authorization: Bearer <token>"), STEP_MS (400),
 *      NO_FILES_NODE=1 (answer like a server without the companion node).
 */
import http from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 8188)
const TOKEN = process.env.FAKE_TOKEN || ''
const STEP_MS = Number(process.env.STEP_MS || 400)
const FILES_NODE = process.env.NO_FILES_NODE !== '1'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(tmpdir(), 'fake-comfy')
const inputDir = join(root, 'input')
const outputDir = join(root, 'output')
const tempDir = join(root, 'temp')
const DIRS = { input: inputDir, output: outputDir, temp: tempDir }
mkdirSync(inputDir, { recursive: true })
mkdirSync(tempDir, { recursive: true })
mkdirSync(join(outputDir, 'video'), { recursive: true })

/* ------------------------------------------------------------- object_info */
const examples = join(here, '../docs/minimax-h3-workflow-examples')
const objectInfo = {}
const generic = (v) =>
  typeof v === 'number' ? (Number.isInteger(v) ? ['INT', { default: v, min: 0, max: 2 ** 53 }] : ['FLOAT', { default: v, min: 0, max: 1e6, step: 0.01 }])
  : typeof v === 'boolean' ? ['BOOLEAN', { default: v }]
  : typeof v === 'string' ? (/\.(safetensors|ckpt|pt)$/.test(v) ? [[v], {}] : ['STRING', {}])
  : ['*']
for (const f of existsSync(examples) ? readdirSync(examples) : []) {
  const wf = JSON.parse(readFileSync(join(examples, f), 'utf8'))
  for (const node of Object.values(wf)) {
    const info = (objectInfo[node.class_type] ??= { input: { required: {}, optional: {} }, output: [], display_name: node.class_type })
    for (const [k, v] of Object.entries(node.inputs)) {
      const base = k.split('.')[0]
      if (Array.isArray(v)) {
        info.input.required[base] ??= ['*']
        continue
      }
      const prev = info.input.required[base]
      if (prev && Array.isArray(prev[0]) && typeof v === 'string' && !prev[0].includes(v)) prev[0].push(v)
      else info.input.required[base] ??= generic(v)
    }
  }
}
Object.assign(objectInfo, {
  MiniMaxH3ImageToVideo: {
    input: {
      required: { prompt: ['STRING', { multiline: true }], width: ['INT', {}], height: ['INT', {}], length: ['INT', {}], clip: ['CLIP'], vae: ['VAE'] },
      optional: { first_frame: ['IMAGE'], last_frame: ['IMAGE'] }
    }
  },
  MiniMaxH3ReferenceToVideo: {
    input: {
      required: {
        prompt: ['STRING', { multiline: true }], width: ['INT', {}], height: ['INT', {}], length: ['INT', {}],
        ref_image_size: [['match', 'fit'], {}], clip: ['CLIP'], vae: ['VAE'], audio_vae: ['VAE'],
        ref_images: ['COMFY_AUTOGROW_V3', { template: { input: { required: { ref_image: ['IMAGE'] } }, prefix: 'ref_image_', min: 1, max: 9 } }]
      },
      optional: {
        ref_videos: ['COMFY_AUTOGROW_V3', { template: { input: { optional: { ref_video: ['IMAGE'] } }, prefix: 'ref_video_', min: 0, max: 3 } }],
        ref_video_audios: ['COMFY_AUTOGROW_V3', { template: { input: { optional: { ref_video_audio: ['AUDIO'] } }, prefix: 'ref_video_audio_', min: 0, max: 3 } }],
        ref_audios: ['COMFY_AUTOGROW_V3', { template: { input: { optional: { ref_audio: ['AUDIO'] } }, prefix: 'ref_audio_', min: 0, max: 3 } }]
      }
    }
  },
  ResolutionSelector: {
    input: {
      required: {
        aspect_ratio: [['1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '9:16 (Vertical)', '16:9 (Widescreen)'], {}],
        megapixels: ['FLOAT', { default: 1, min: 0.1, max: 4, step: 0.1 }],
        multiple: ['INT', { default: 32, min: 1, max: 256 }]
      }
    }
  },
  PrimitiveFloat: { input: { required: { value: ['FLOAT', { min: -1e9, max: 1e9, step: 0.1 }] } } },
  PrimitiveInt: { input: { required: { value: ['INT', { min: -1e9, max: 1e9 }] } } },
  PrimitiveBoolean: { input: { required: { value: ['BOOLEAN', {}] } } },
  PrimitiveStringMultiline: { input: { required: { value: ['STRING', { multiline: true }] } } },
  LoadImage: { input: { required: { image: [['example.png'], { image_upload: true }] } } },
  LoadVideo: { input: { required: { file: [['example.mp4'], { video_upload: true }] } } },
  LoadAudio: { input: { required: { audio: [['example.wav'], { audio_upload: true }] } } },
  GetVideoComponents: { input: { required: { video: ['VIDEO'] } } }
})
const FILE_FIELDS = { LoadImage: 'image', LoadVideo: 'file', LoadAudio: 'audio' }

/* -------------------------------------------------------------- test media */
const variants = []
function makeVideos() {
  const hues = [0, 120, 240]
  for (const [i, h] of hues.entries()) {
    const file = join(root, `variant-${i}.mp4`)
    if (!existsSync(file)) {
      try {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x480:rate=24:duration=3',
          '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 200}:duration=3`, '-vf', `hue=h=${h}`, '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
      } catch {
        writeFileSync(file, Buffer.alloc(0))
      }
    }
    variants.push(file)
  }
}
makeVideos()

/* ------------------------------------------------------------------- state */
const queue = [] // { id, number, prompt, clientId }
let running = null // { id, ..., interrupted }
const history = {}
const seenHashes = new Set()
let counter = 0
let offlineUntil = 0
const sockets = new Map() // clientId -> Set<ws>

const send = (clientId, type, data) => {
  const msg = JSON.stringify({ type, data })
  const targets = clientId ? sockets.get(clientId) ?? [] : [...sockets.values()].flatMap((s) => [...s])
  for (const ws of targets) if (ws.readyState === 1) ws.send(msg)
}
const broadcastStatus = () => send(null, 'status', { status: { exec_info: { queue_remaining: queue.length + (running ? 1 : 0) } } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const promptText = (p) => Object.values(p).map((n) => [n.inputs?.prompt, n.inputs?.value]).flat().filter((v) => typeof v === 'string').join(' ')

async function worker() {
  for (;;) {
    if (!queue.length || running) {
      await sleep(100)
      continue
    }
    running = queue.shift()
    broadcastStatus()
    await execute(running)
    running = null
    broadcastStatus()
  }
}

async function execute(job) {
  const { id, prompt, clientId } = job
  const msgs = []
  const emit = (type, data) => {
    const d = { ...data, prompt_id: id, timestamp: Date.now() }
    if (type.startsWith('execution_')) msgs.push([type, d])
    send(clientId, type, d)
  }
  const text = promptText(prompt)
  const hash = createHash('sha1').update(JSON.stringify(prompt)).digest('hex')
  emit('execution_start', {})
  const ids = Object.keys(prompt)
  const outputNode = ids.find((n) => prompt[n].class_type === 'SaveVideo') ?? ids[ids.length - 1]
  const sampler = ids.find((n) => /Sampler/.test(prompt[n].class_type))
  const seed = Number(Object.values(prompt).find((n) => n.inputs?.noise_seed !== undefined)?.inputs.noise_seed ?? 0)
  const file = `MiniMax_H3_${String(++counter).padStart(5, '0')}_.mp4`
  if (seenHashes.has(hash)) {
    emit('execution_cached', { nodes: ids })
    const prev = Object.values(history).find((h) => h.hash === hash)
    history[id] = { hash, prompt: [job.number, id, prompt, {}, [outputNode]], outputs: prev?.outputs ?? {}, status: { status_str: 'success', completed: true, messages: msgs } }
    emit('execution_success', {})
    return
  }
  emit('execution_cached', { nodes: [] })
  const turbo = Object.values(prompt).some((n) => n.class_type === 'PrimitiveBoolean' && n.inputs.value === true)
  const steps = turbo ? 4 : 8
  for (const n of ids) {
    if (job.interrupted) break
    send(clientId, 'executing', { node: n, display_node: n, prompt_id: id })
    if (n === sampler) {
      for (let s = 1; s <= steps; s++) {
        if (job.interrupted) break
        await sleep(STEP_MS * (text.includes('#slow') ? 4 : 1))
        if (text.includes('#fail') && s === 2) {
          emit('execution_error', { node_id: n, node_type: prompt[n].class_type, exception_type: 'RuntimeError', exception_message: 'Expected tensor of shape [1, 16] but got [1, 32].', traceback: ['Traceback (most recent call last):\n', '  File "execution.py", line 1\n'] })
          history[id] = { prompt: [job.number, id, prompt, {}, [outputNode]], outputs: {}, status: { status_str: 'error', completed: false, messages: msgs } }
          return
        }
        if (text.includes('#oom') && s === 3) {
          emit('execution_error', { node_id: n, node_type: prompt[n].class_type, exception_type: 'torch.OutOfMemoryError', exception_message: 'CUDA out of memory. Tried to allocate 2.00 GiB.', traceback: [] })
          history[id] = { prompt: [job.number, id, prompt, {}, [outputNode]], outputs: {}, status: { status_str: 'error', completed: false, messages: msgs } }
          return
        }
        send(clientId, 'progress', { value: s, max: steps, node: n, prompt_id: id })
      }
    } else await sleep(15)
  }
  if (job.interrupted) {
    emit('execution_interrupted', { node_id: sampler, node_type: 'SamplerCustomAdvanced', executed: [] })
    history[id] = { prompt: [job.number, id, prompt, {}, [outputNode]], outputs: {}, status: { status_str: 'error', completed: false, messages: msgs } }
    return
  }
  writeFileSync(join(outputDir, 'video', file), readFileSync(variants[seed % variants.length]))
  const outputs = { [outputNode]: { images: [{ filename: file, subfolder: 'video', type: 'output' }], animated: [true] } }
  send(clientId, 'executed', { node: outputNode, output: outputs[outputNode], prompt_id: id })
  seenHashes.add(hash)
  history[id] = { hash, prompt: [job.number, id, prompt, {}, [outputNode]], outputs, status: { status_str: 'success', completed: true, messages: msgs } }
  emit('execution_success', {})
  send(clientId, 'executing', { node: null, prompt_id: id })
}

/* -------------------------------------------------------------------- http */
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = (req) => new Promise((r) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => r(Buffer.concat(chunks)))
})
/** Path of a file inside the input, output or temp folder, or null if it would be outside. */
const fileIn = (type, subfolder, filename) => {
  const dir = DIRS[type]
  if (!dir || !filename) return null
  const file = resolve(dir, subfolder || '', filename)
  return file.startsWith(dir + sep) ? file : null
}
const listDir = (dir) =>
  readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => {
    const st = statSync(join(e.parentPath, e.name))
    return { filename: e.name, subfolder: relative(dir, e.parentPath).split(sep).join('/'), size: st.size, modified: st.mtimeMs / 1000 }
  })
const authorized = (req) => !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`

function validate(prompt) {
  const errors = {}
  for (const [nid, node] of Object.entries(prompt)) {
    if (!objectInfo[node.class_type]) {
      errors[nid] = { errors: [{ type: 'missing_node_type', message: `Node type ${node.class_type} not found`, details: '', extra_info: {} }], class_type: node.class_type }
      continue
    }
    const fileField = FILE_FIELDS[node.class_type]
    if (fileField && !existsSync(join(inputDir, String(node.inputs[fileField])))) {
      errors[nid] = { errors: [{ type: 'value_not_in_list', message: 'Value not in list', details: `${fileField}: '${node.inputs[fileField]}' not in list`, extra_info: { input_name: fileField } }], class_type: node.class_type }
    }
    for (const v of Object.values(node.inputs)) {
      if (Array.isArray(v) && !prompt[v[0]]) {
        errors[nid] = { errors: [{ type: 'bad_link', message: `Link to missing node ${v[0]}`, details: '', extra_info: {} }], class_type: node.class_type }
      }
    }
  }
  if (promptText(prompt).includes('#reject')) {
    const nid = Object.keys(prompt).find((n) => prompt[n].class_type === 'PrimitiveFloat') ?? Object.keys(prompt)[0]
    errors[nid] = { errors: [{ type: 'value_bigger_than_max', message: 'Value bigger than max', details: 'value 15.0 bigger than max of 10.0', extra_info: { input_name: 'value' } }], class_type: prompt[nid].class_type }
  }
  return errors
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (Date.now() < offlineUntil) {
    req.socket.destroy()
    return
  }
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized' })
  const p = url.pathname
  try {
    if (p === '/object_info' && req.method === 'GET') return json(res, 200, objectInfo)
    if (p === '/prompt' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString())
      const errors = validate(body.prompt)
      if (Object.keys(errors).length) {
        return json(res, 400, { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '', extra_info: {} }, node_errors: errors })
      }
      const id = randomUUID()
      const number = ++counter
      queue.push({ id, number, prompt: body.prompt, clientId: body.client_id })
      broadcastStatus()
      return json(res, 200, { prompt_id: id, number, node_errors: {} })
    }
    if (p === '/queue' && req.method === 'GET') {
      const entry = (j) => [j.number, j.id, j.prompt, { client_id: j.clientId }, []]
      return json(res, 200, { queue_running: running ? [entry(running)] : [], queue_pending: queue.map(entry) })
    }
    if (p === '/queue' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      if (body.clear) queue.length = 0
      for (const id of body.delete ?? []) {
        const i = queue.findIndex((j) => j.id === id)
        if (i >= 0) queue.splice(i, 1)
      }
      broadcastStatus()
      return json(res, 200, {})
    }
    if (p === '/interrupt' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      if (running && (!body.prompt_id || body.prompt_id === running.id)) running.interrupted = true
      return json(res, 200, {})
    }
    if (p.startsWith('/history/') && req.method === 'GET') {
      const id = decodeURIComponent(p.slice('/history/'.length))
      const h = history[id]
      return json(res, 200, h ? { [id]: { prompt: h.prompt, outputs: h.outputs, status: h.status } } : {})
    }
    if (p === '/history' && req.method === 'GET') return json(res, 200, history)
    if (p === '/view' && req.method === 'GET') {
      const file = fileIn(url.searchParams.get('type') || 'output', url.searchParams.get('subfolder'), url.searchParams.get('filename'))
      if (!file || !existsSync(file)) return json(res, 404, { error: 'not found' })
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      return res.end(readFileSync(file))
    }
    if (p === '/upload/image' && req.method === 'POST') {
      const buf = await readBody(req)
      const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: buf }).formData()
      const image = form.get('image')
      if (!image || typeof image === 'string') return json(res, 400, { error: 'no image' })
      if (image.name.includes('reject')) return json(res, 500, { error: 'disk full' })
      writeFileSync(join(inputDir, image.name), Buffer.from(await image.arrayBuffer()))
      return json(res, 200, { name: image.name, subfolder: '', type: 'input' })
    }
    if (FILES_NODE && p === '/comfy_director/files' && req.method === 'GET') {
      const dir = DIRS[url.searchParams.get('type')]
      if (!dir) return json(res, 400, { error: 'type must be input, output or temp.' })
      return json(res, 200, { version: 2, files: listDir(dir) })
    }
    if (FILES_NODE && p === '/comfy_director/thumb' && req.method === 'GET') {
      const q = url.searchParams
      const file = fileIn(q.get('type'), q.get('subfolder'), q.get('filename'))
      const ext = (file?.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
      if (!file || !existsSync(file)) return json(res, 404, { error: 'not found' })
      let data = null
      let type = 'image/jpeg'
      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
        data = readFileSync(file)
        type = `image/${ext === 'jpg' ? 'jpeg' : ext}`
      } else if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
        try {
          data = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${Number(q.get('size')) || 160}:-2`, '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'])
        } catch {
          /* no ffmpeg, or not a video */
        }
      }
      if (!data?.length) return json(res, 404, { error: 'no thumbnail' })
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' })
      return res.end(data)
    }
    if (FILES_NODE && p === '/comfy_director/files/delete' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const deleted = []
      const errors = []
      for (const f of body.files ?? []) {
        const ref = { filename: String(f.filename ?? ''), subfolder: String(f.subfolder ?? ''), type: String(f.type ?? '') }
        const file = fileIn(ref.type, ref.subfolder, ref.filename)
        if (!file || (existsSync(file) && !statSync(file).isFile())) {
          errors.push({ ...ref, message: 'Not a file in the input, output or temp folder.' })
          continue
        }
        rmSync(file, { force: true })
        deleted.push(ref)
      }
      // Like the node: cached results would name the deleted files.
      if (deleted.some((f) => f.type !== 'input')) seenHashes.clear()
      return json(res, 200, { deleted, errors })
    }
    if (p === '/_fake/other-client' && req.method === 'POST') {
      const prompt = JSON.parse(readFileSync(join(examples, 'video_minimax_h3_t2v.json'), 'utf8'))
      queue.push({ id: randomUUID(), number: ++counter, prompt, clientId: 'someone-else' })
      broadcastStatus()
      return json(res, 200, {})
    }
    if (p === '/_fake/offline' && req.method === 'POST') {
      offlineUntil = Date.now() + Number(url.searchParams.get('seconds') || 10) * 1000
      for (const set of sockets.values()) for (const ws of set) ws.terminate()
      return json(res, 200, {})
    }
    json(res, 404, { error: 'not found' })
  } catch (e) {
    json(res, 500, { error: String(e) })
  }
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname !== '/ws' || Date.now() < offlineUntil || !authorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const clientId = url.searchParams.get('clientId') || randomUUID()
    if (!sockets.has(clientId)) sockets.set(clientId, new Set())
    sockets.get(clientId).add(ws)
    ws.on('close', () => sockets.get(clientId)?.delete(ws))
    ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: queue.length } }, sid: clientId } }))
  })
})

server.listen(PORT, () => {
  console.log(`fake ComfyUI on http://127.0.0.1:${PORT}${TOKEN ? ' (token required)' : ''}`)
  void worker()
})
