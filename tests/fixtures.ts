import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ApiWorkflow } from '../src/core/workflow/types'
import type { ObjectInfo } from '../src/core/workflow/objectInfo'

const dir = resolve(__dirname, '../docs/minimax-h3-workflow-examples')
export const r2v = (): ApiWorkflow => JSON.parse(readFileSync(resolve(dir, 'video_minimax_h3_r2v.json'), 'utf8'))
export const fl2v = (): ApiWorkflow => JSON.parse(readFileSync(resolve(dir, 'video_minimax_h3_i2v_continuation.json'), 'utf8'))
export const t2v = (): ApiWorkflow => JSON.parse(readFileSync(resolve(dir, 'video_minimax_h3_t2v.json'), 'utf8'))

/** Minimal object_info for the MiniMax H3 nodes (shapes as the server sends them). */
export const objectInfo: ObjectInfo = {
  MiniMaxH3ImageToVideo: {
    input: {
      required: { prompt: ['STRING', { multiline: true }], width: ['INT', {}], height: ['INT', {}], length: ['INT', {}] },
      optional: { first_frame: ['IMAGE'], last_frame: ['IMAGE'] }
    }
  },
  MiniMaxH3ReferenceToVideo: {
    input: {
      required: {
        prompt: ['STRING', { multiline: true }],
        ref_images: ['COMFY_AUTOGROW_V3', { template: { input: { required: { ref_image: ['IMAGE'] } }, prefix: 'ref_image_', min: 1, max: 9 } }]
      }
    }
  },
  ResolutionSelector: {
    input: {
      required: {
        aspect_ratio: [['1:1 (Square)', '2:3 (Portrait Photo)', '16:9 (Widescreen)'], {}],
        megapixels: ['FLOAT', { min: 0.1, max: 4, step: 0.1 }],
        multiple: ['INT', { min: 1, max: 128 }]
      }
    }
  },
  RandomNoise: { input: { required: { noise_seed: ['INT', { min: 0, max: 18446744073709551615 }] } } },
  PrimitiveFloat: { input: { required: { value: ['FLOAT', { min: -1e9, max: 1e9 }] } } },
  LoadImage: { input: { required: { image: [['a.png'], {}] } } },
  UNETLoader: { input: { required: { unet_name: [['minimax_h3_ref2va_pruned_int8_convrot.safetensors'], {}] } } }
}
