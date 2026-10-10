/** Files in the server's folders, as listed by the companion node (comfyui-node/comfy_director_files). */

export type ServerFolder = 'input' | 'output' | 'temp'

export const SERVER_FOLDERS: ServerFolder[] = ['input', 'output', 'temp']

export interface ServerFile {
  filename: string
  /** Folder inside the input, output or temp folder, with forward slashes. Empty at the top level. */
  subfolder: string
  type: ServerFolder
  /** Bytes. */
  size: number
  /** Last modified, in milliseconds since the epoch. */
  modified: number
}

export type ServerFileRef = Pick<ServerFile, 'filename' | 'subfolder' | 'type'>

export interface ServerDeleteResult {
  deleted: ServerFileRef[]
  errors: (ServerFileRef & { message: string })[]
}

/** `subfolder/filename`, the form a workflow uses to name a file in a folder. */
export function serverFilePath(f: Pick<ServerFile, 'filename' | 'subfolder'>): string {
  return f.subfolder ? `${f.subfolder}/${f.filename}` : f.filename
}
