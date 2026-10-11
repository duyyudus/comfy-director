import type { ApiWorkflow, InputConstraints } from './types'
import { consumersOf, isLink, titleOf } from './graph'
import { keyFromTitle } from './keys'

export interface StandardField {
  /** Key and label when the field name alone would say too little (`switch`). */
  key?: string
  label?: string
  /** Hover text: what to start with and why. */
  tip?: string
  /** Bounds to use when the server's node info gives none. */
  constraints?: InputConstraints
  /** Narrows the rule to nodes that play the role the key names. */
  when?: (wf: ApiWorkflow, nodeId: string) => boolean
  /** False: recognised (key, label, bounds) but unticked on import. Default true. */
  exposed?: boolean
  /** A prompt: the key says whether the text feeds the positive or the negative side of the sampler. */
  prompt?: boolean
  /** Second prompt field of one node (`clip_l`): added to the prompt's key and label. */
  part?: string
  /** Key and label that depend on where the node sits in the graph (a LoRA's place in its chain). Replaces `key` and `label`. */
  name?: (wf: ApiWorkflow, nodeId: string) => { key: string; label: string }
}

/** One rule, or several tried in order (the first whose `when` holds wins). */
export type StandardRule = StandardField | StandardField[]

export function standardRule(rules: StandardRule | undefined, wf: ApiWorkflow, nodeId: string): StandardField | undefined {
  return (Array.isArray(rules) ? rules : rules ? [rules] : []).find((r) => !r.when || r.when(wf, nodeId))
}

const LORA_LOADERS = new Set(['LoraLoader', 'LoraLoaderModelOnly'])

const isLora = (wf: ApiWorkflow, nodeId: string): boolean => LORA_LOADERS.has(wf[nodeId]?.class_type)

/** Where a LoRA loader sits in its chain (each loader takes the previous one's `model`), counting from 1 at the loader nearest the model. */
export function loraPosition(wf: ApiWorkflow, nodeId: string): number {
  let position = 1
  const seen = new Set([nodeId])
  for (let id = nodeId; ; ) {
    const model = wf[id].inputs.model
    if (!isLink(model) || !isLora(wf, model[0]) || seen.has(model[0])) break
    id = model[0]
    seen.add(id)
    position++
  }
  return position
}

export type PromptRole = 'positive' | 'negative'

/**
 * Which side of the sampler a conditioning node ends up on: the first consumer input called `positive` or `negative`,
 * looking through the nodes in between (guidance, combine, area). Flux's guider has a single `conditioning` input, which is the positive.
 */
export function promptRole(wf: ApiWorkflow, nodeId: string): PromptRole | null {
  const seen = new Set([nodeId])
  let frontier = [nodeId]
  for (let depth = 0; depth < 10 && frontier.length; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const c of consumersOf(wf, id)) {
        const m = c.input.match(/^(?:conditioning_)?(positive|negative)(?:_conditioning)?$/)
        if (m) return m[1] as PromptRole
        if (c.input === 'conditioning' && wf[c.nodeId].class_type === 'BasicGuider') return 'positive'
        if (!seen.has(c.nodeId)) {
          seen.add(c.nodeId)
          next.push(c.nodeId)
        }
      }
    }
    frontier = next
  }
  return null
}

/**
 * Key and label of a prompt field on a regular node: `prompt` or `negative prompt` by role, so every workflow's positive
 * prompt shares one value with the `Input Text (Prompt)` node. With no role, the title if it was set, else the field name.
 */
export function promptName(wf: ApiWorkflow, nodeId: string, field: string, part?: string): { key: string; label: string } {
  const role = promptRole(wf, nodeId)
  const title = titleOf(wf[nodeId])
  let key: string
  let label: string
  if (role) {
    key = role === 'negative' ? 'negative prompt' : 'prompt'
    label = role === 'negative' ? 'Negative prompt' : 'Prompt'
  } else if (title !== wf[nodeId].class_type) {
    key = keyFromTitle(title)
    label = title
  } else {
    key = field
    label = field.charAt(0).toUpperCase() + field.slice(1)
  }
  return part ? { key: `${key} ${part}`, label: `${label} (${part})` } : { key, label }
}

/** SeedVR2 upscale workflows (built-in and numz nodes): the settings that change the look, the scale or the seams. */
const SEEDVR2_FIELDS: Record<string, Record<string, StandardRule>> = {
  // SeedVR2 upscale: the factor of the resize step in front of the model.
  ResizeImageMaskNode: {
    'resize_type.multiplier': {
      key: 'scale_multiplier',
      label: 'Scale multiplier',
      tip: 'How much to enlarge the video before SeedVR2 runs. Start with 1.5. A larger factor makes the model invent more detail, and artifacts show up mostly at large output sizes.'
    }
  },
  // SeedVR2 upscale: the only sampler settings that could change how much the model invents. Other KSamplers are left alone.
  KSampler: {
    cfg: {
      tip: 'Guidance strength. Start with 1, the value of the SeedVR2 template: this one-step model is meant to run without guidance. Experimental, its effect here is not documented.',
      when: isSeedVr2Sampler
    },
    denoise: {
      tip: 'Start with 1 (full). Lower values start the sampler from less noise, and on this one-step model that may soften the result instead of keeping it closer to the source. Experimental: compare on a fixed seed.',
      constraints: { min: 0, max: 1, step: 0.01 },
      when: isSeedVr2Sampler
    }
  },
  // SeedVR2 upscale (numz's custom nodes): what sets the scale, the look and the batch seams. Model and memory settings stay fixed.
  SeedVR2VideoUpscaler: {
    resolution: {
      tip: 'Size of the shorter edge of the result; the aspect ratio is kept. Start with 1080. The more it enlarges, the more detail the model invents, and artifacts show up mostly at large output sizes.'
    },
    batch_size: {
      tip: 'Frames processed together; must be 4n+1 (1, 5, 9, 13...). Start with 5, the least that gives temporal consistency, or match the clip length. Higher is more consistent but needs much more VRAM. Use 1 only for single images.',
      constraints: { min: 1, step: 4, integer: true }
    },
    color_correction: {
      tip: 'How the colours of the result are matched to the source. Start with lab, the most faithful. Try wavelet if lab looks off. none keeps the colours the model produced.',
      constraints: { options: ['lab', 'wavelet', 'wavelet_adaptive', 'hsv', 'adain', 'none'] }
    },
    temporal_overlap: {
      tip: 'Frames shared between batches and blended. Start with 0. Raise it to 2 or 3 if the joins between batches flicker or cut. It only matters when the clip takes more than one batch.',
      constraints: { min: 0, max: 16, step: 1, integer: true }
    },
    input_noise_scale: {
      tip: 'Noise added to the input, 0 to 1. Start with 0. Try 0.1 to 0.3 if large output sizes show artifacts. Guides disagree on whether more or less helps over-sharpening on clean footage, so compare on a fixed seed.',
      constraints: { min: 0, max: 1, step: 0.01 }
    },
    latent_noise_scale: {
      tip: 'Noise added while the model works, 0 to 1. Start with 0. A small value (about 0.05 to 0.15) softens excess detail: the nearest thing to a "less AI look" control.',
      constraints: { min: 0, max: 1, step: 0.01 }
    }
  },
  // SeedVR2 upscale (numz): the model, and the memory settings that decide whether and how fast a clip fits on the GPU.
  SeedVR2LoadDiTModel: {
    model: {
      tip: 'The upscaling model. Start with seedvr2_ema_7b_fp16, the best quality offered. 3B is faster and lighter. fp8 and GGUF Q8 save VRAM for a small quality cost, Q4 for more. The "sharp" 7B variants add more detail.'
    },
    offload_device: {
      tip: 'Where the model waits while it is not running. none keeps it on the GPU: fastest, most VRAM. cpu frees VRAM, which long or large clips may need. Start with none, and set cpu when you use blocks_to_swap or run out of memory.'
    },
    blocks_to_swap: {
      tip: 'Transformer blocks moved to the CPU to save VRAM: 0 is off, up to 36 on 7B (32 on 3B). Start with 0 and raise it (try 16) only on out-of-memory errors, since more swapping is slower. It only works when offload_device is not none.',
      constraints: { min: 0, max: 36, step: 1, integer: true }
    }
  },
  SeedVR2LoadVAEModel: {
    encode_tiled: {
      tip: 'Encode the video in tiles. Start with it off, which is faster, and turn it on if you run out of memory while encoding. Tile seams are possible; the tile size and overlap are set in the workflow.'
    },
    decode_tiled: {
      tip: 'Decode the result in tiles. Start with it off, which is faster, and turn it on if you run out of memory while decoding. Tile seams are possible; the tile size and overlap are set in the workflow.'
    }
  },
  // SeedVR2 upscale: an if/else switch that picks the trimmed clip (a `Video Slice` on `on_true`) over the whole video.
  ComfySwitchNode: {
    switch: {
      key: 'trim_video',
      label: 'Trim video',
      tip: 'Off upscales the whole video. On upscales only the clip cut by the Video Slice node of the workflow. Its start time and duration are not inputs here, so they stay as in the workflow file.',
      when: (wf, nodeId) => {
        const on = wf[nodeId].inputs.on_true
        return isLink(on) && wf[on[0]]?.class_type === 'Video Slice'
      }
    }
  }
}

function isSeedVr2Sampler(wf: ApiWorkflow, nodeId: string): boolean {
  const positive = wf[nodeId].inputs.positive
  return isLink(positive) && wf[positive[0]]?.class_type === 'SeedVR2Conditioning'
}

const notSeedVr2 = (wf: ApiWorkflow, nodeId: string): boolean => !isSeedVr2Sampler(wf, nodeId)

const prompt = (more: StandardField = {}): StandardField => ({ prompt: true, constraints: { multiline: true }, ...more })
const unticked = (key?: string, label?: string): StandardField => ({ ...(key && { key }), ...(label && { label }), exposed: false })
const DENOISE: InputConstraints = { min: 0, max: 1, step: 0.01 }
/** A LoRA field: `lora`, `lora_2`... by place in the chain, so a stack keeps its keys when node ids change. */
const loraField = (key: string, label: string, exposed = true): StandardField => ({
  exposed,
  name: (wf, nodeId) => {
    const n = loraPosition(wf, nodeId)
    return n > 1 ? { key: `${key}_${n}`, label: `${label} ${n}` } : { key, label }
  }
})

// Batch size of a latent: its own key, since `batch_size` on the SeedVR2 upscaler means something else (4n+1 frames).
const LATENT_BATCH: StandardField = { key: 'latent_batch', label: 'Batch size' }
const LATENT_IMAGE: Record<string, StandardRule> = { width: {}, height: {}, batch_size: LATENT_BATCH }
const LATENT_VIDEO: Record<string, StandardRule> = { width: {}, height: {}, length: {}, batch_size: LATENT_BATCH }
const UPSCALE_METHOD: StandardField = unticked('upscale_method')
const SAMPLER: StandardField = unticked('sampler', 'Sampler')

/**
 * The core ComfyUI nodes with settings a shot would change. The creative ones (prompts, size, steps, cfg, strengths) are ticked on import;
 * model files, sampler and scheduler are recognised, with a stable key, but start unticked. Anything else stays a field to expose by hand.
 */
const CORE_FIELDS: Record<string, Record<string, StandardRule>> = {
  // Prompts
  CLIPTextEncode: { text: prompt() },
  CLIPTextEncodeSDXL: { text_g: prompt(), text_l: prompt({ part: 'clip_l' }) },
  CLIPTextEncodeSDXLRefiner: { text: prompt() },
  CLIPTextEncodeSD3: { t5xxl: prompt(), clip_l: prompt({ part: 'clip_l' }), clip_g: prompt({ part: 'clip_g' }) },
  CLIPTextEncodeHunyuanDiT: { bert: prompt(), mt5xl: prompt({ part: 'mt5xl' }) },
  CLIPTextEncodeFlux: { t5xxl: prompt(), clip_l: prompt({ part: 'clip_l' }), guidance: {} },
  FluxGuidance: { guidance: {} },
  // Size, length and batch of what is generated
  EmptyLatentImage: LATENT_IMAGE,
  EmptySD3LatentImage: LATENT_IMAGE,
  EmptyFlux2LatentImage: LATENT_IMAGE,
  EmptyHunyuanImageLatent: LATENT_IMAGE,
  EmptyHunyuanLatentVideo: LATENT_VIDEO,
  EmptyMochiLatentVideo: LATENT_VIDEO,
  EmptyLTXVLatentVideo: LATENT_VIDEO,
  EmptyCosmosLatentVideo: LATENT_VIDEO,
  EmptyHunyuanVideo15Latent: LATENT_VIDEO,
  HunyuanVideo15ImageToVideo: LATENT_VIDEO,
  HunyuanImageToVideo: LATENT_VIDEO,
  CosmosImageToVideoLatent: LATENT_VIDEO,
  CosmosPredict2ImageToVideoLatent: LATENT_VIDEO,
  WanImageToVideo: LATENT_VIDEO,
  WanFirstLastFrameToVideo: LATENT_VIDEO,
  Wan22ImageToVideoLatent: LATENT_VIDEO,
  WanTrackToVideo: LATENT_VIDEO,
  WanFunControlToVideo: LATENT_VIDEO,
  Wan22FunControlToVideo: LATENT_VIDEO,
  WanFunInpaintToVideo: LATENT_VIDEO,
  WanVaceToVideo: LATENT_VIDEO,
  WanCameraImageToVideo: LATENT_VIDEO,
  WanPhantomSubjectToVideo: LATENT_VIDEO,
  WanSoundImageToVideo: LATENT_VIDEO,
  WanSoundImageToVideoExtend: LATENT_VIDEO,
  WanHuMoImageToVideo: LATENT_VIDEO,
  WanAnimateToVideo: LATENT_VIDEO,
  WanAnimate2ToVideo: LATENT_VIDEO,
  WanInfiniteTalkToVideo: LATENT_VIDEO,
  LTXVImgToVideo: LATENT_VIDEO,
  EmptyLatentAudio: { seconds: {}, batch_size: LATENT_BATCH },
  // Resizing
  ResolutionSelector: { aspect_ratio: {}, megapixels: {} },
  ImageScale: { width: { key: 'resize_width', label: 'Resize width' }, height: { key: 'resize_height', label: 'Resize height' }, upscale_method: UPSCALE_METHOD, crop: unticked('resize_crop') },
  ImageScaleBy: { scale_by: {}, upscale_method: UPSCALE_METHOD },
  ImageScaleToTotalPixels: { megapixels: {}, upscale_method: UPSCALE_METHOD },
  LatentUpscaleBy: { scale_by: { key: 'latent_scale_by', label: 'Latent scale by' }, upscale_method: UPSCALE_METHOD },
  // Sampling (the SeedVR2 sampler keeps the fixed settings of its recipe, see SEEDVR2_FIELDS)
  KSampler: {
    steps: { when: notSeedVr2 },
    cfg: [SEEDVR2_FIELDS.KSampler.cfg as StandardField, { when: notSeedVr2 }],
    denoise: [SEEDVR2_FIELDS.KSampler.denoise as StandardField, { constraints: DENOISE, when: notSeedVr2 }],
    sampler_name: { ...SAMPLER, when: notSeedVr2 },
    scheduler: { ...unticked(), when: notSeedVr2 }
  },
  KSamplerAdvanced: { steps: {}, cfg: {}, sampler_name: SAMPLER, scheduler: unticked() },
  KSamplerSelect: { sampler_name: SAMPLER },
  BasicScheduler: { steps: {}, denoise: unticked(), scheduler: unticked() },
  SamplerCustom: { cfg: {} },
  CFGGuider: { cfg: {} },
  ModelSamplingSD3: { shift: unticked() },
  ModelSamplingAuraFlow: { shift: unticked() },
  // Models: names must match files on the server, so they start unticked (LoRAs excepted: they are what a shot picks, a Lightning one too)
  CheckpointLoaderSimple: { ckpt_name: unticked('checkpoint', 'Checkpoint') },
  UNETLoader: { unet_name: unticked('unet', 'Diffusion model') },
  VAELoader: { vae_name: unticked('vae', 'VAE') },
  CLIPLoader: { clip_name: unticked('clip', 'Text encoder') },
  DualCLIPLoader: { clip_name1: unticked('clip_1', 'Text encoder 1'), clip_name2: unticked('clip_2', 'Text encoder 2') },
  CLIPVisionLoader: { clip_name: unticked('clip_vision', 'CLIP vision model') },
  ControlNetLoader: { control_net_name: unticked('controlnet', 'ControlNet') },
  UpscaleModelLoader: { model_name: unticked('upscale_model', 'Upscale model') },
  LoraLoader: {
    lora_name: loraField('lora', 'LoRA'),
    strength_model: loraField('lora_strength', 'LoRA strength'),
    strength_clip: loraField('lora_clip_strength', 'LoRA strength (CLIP)', false)
  },
  LoraLoaderModelOnly: { lora_name: loraField('lora', 'LoRA'), strength_model: loraField('lora_strength', 'LoRA strength') },
  ControlNetApply: { strength: { key: 'controlnet_strength', label: 'ControlNet strength' } },
  ControlNetApplyAdvanced: {
    strength: { key: 'controlnet_strength', label: 'ControlNet strength' },
    start_percent: unticked('controlnet_start', 'ControlNet start'),
    end_percent: unticked('controlnet_end', 'ControlNet end')
  },
  // Video: the frame rate also sets frame counts in graphs that compute them, so it is not ticked
  CreateVideo: { fps: unticked() }
}

/** Literal fields on known node classes discovered as inputs, by node class and field. */
export const STANDARD_FIELDS: Record<string, Record<string, StandardRule>> = { ...CORE_FIELDS, ...SEEDVR2_FIELDS, KSampler: CORE_FIELDS.KSampler }
