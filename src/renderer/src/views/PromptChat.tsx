import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { InputFile, PrompterRecord, ShotChat } from '@shared/types'
import { splitReply } from '@core/prompter/llm'
import { chatListeners, useStore } from '../lib/store'
import { api, errorMessage, media } from '../lib/api'
import { cn } from '../lib/cn'
import { Button, Card, Empty, Select, Spinner, Textarea } from '../components/ui'
import { Markdown } from '../components/Markdown'

const LAST_PROMPTER = 'chat-prompter'
/** `minimax-h3` and `minimax_h3` name the same workflow type. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_')

/** The LLM prompter whose skill is made for this workflow, else the one used last, else the first. */
function defaultPrompter(list: PrompterRecord[], workflowId: string | undefined): number | null {
  const skillOf = (p: PrompterRecord): string => (p.config.type === 'llm' && p.config.llm.skill) || ''
  const wf = workflowId ? norm(workflowId) : ''
  const matching = list
    .filter((p) => skillOf(p) && (wf === norm(skillOf(p)) || wf.startsWith(`${norm(skillOf(p))}_`)))
    .sort((a, b) => skillOf(b).length - skillOf(a).length)[0]
  const last = Number(localStorage.getItem(LAST_PROMPTER))
  return (matching ?? list.find((p) => p.id === last) ?? list[0])?.id ?? null
}

/** A shot's conversation with an LLM prompter: describe the shot, get a prompt, render, come back and revise. */
export function PromptChat({ projectPath, shotId, workflowId, currentPrompt, shotImages, listMode, onUsePrompt, onClose }: {
  projectPath: string
  shotId: number
  workflowId: string | undefined
  currentPrompt: string
  /** The images in the shot's form, in the order the workflow takes them. */
  shotImages: InputFile[]
  listMode: boolean
  onUsePrompt: (text: string) => void
  onClose: () => void
}): ReactNode {
  const { go, toast } = useStore()
  const [prompters, setPrompters] = useState<PrompterRecord[] | null>(null)
  const [prompterId, setPrompterId] = useState<number | null>(null)
  const [chat, setChat] = useState<ShotChat | null>(null)
  const [text, setText] = useState('')
  const [attached, setAttached] = useState<InputFile[]>([])
  const [busy, setBusy] = useState(false)
  /** The reply so far, while it is being written. */
  const [live, setLive] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.listPrompters().then((all) => {
      const llm = all.filter((p) => p.type === 'llm')
      setPrompters(llm)
      setPrompterId(defaultPrompter(llm, workflowId))
    })
    // The prompter is chosen once per visit; switching the workflow tab does not override the user's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void api.getChat(projectPath, shotId).then(setChat).catch((e) => toast(errorMessage(e), 'error'))
  }, [projectPath, shotId, toast])
  useEffect(() => {
    const l = (e: { projectPath: string; shotId: number; delta: string }): void => {
      if (e.projectPath === projectPath && e.shotId === shotId) setLive((t) => t + e.delta)
    }
    chatListeners.add(l)
    return () => void chatListeners.delete(l)
  }, [projectPath, shotId])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [chat, busy, error, live])

  const prompter = prompters?.find((p) => p.id === prompterId)
  const skill = prompter?.config.type === 'llm' ? prompter.config.llm.skill : undefined
  const messages = chat?.messages ?? []
  const waiting = messages[messages.length - 1]?.role === 'user'

  // "Image N" counts across the whole chat, the same way the prompter is told about them.
  const firstImage = useMemo(() => {
    const at: number[] = []
    let n = 1
    for (const m of messages) {
      at.push(n)
      n += m.images.length
    }
    return { at, next: n }
  }, [messages])

  const send = async (message: { text: string; images: string[] } | null): Promise<void> => {
    if (!prompterId) return
    setBusy(true)
    setError(null)
    setLive('')
    if (message) {
      // Shown at once; the stored copy replaces it when the reply (or the failure) comes back.
      setChat((c) => ({
        messages: [...(c?.messages ?? []), { id: -1, role: 'user', text: message.text, images: message.images, createdAt: new Date().toISOString() }],
        files: { ...c?.files, ...Object.fromEntries(attached.map((f) => [f.name, f])) }
      }))
      setText('')
      setAttached([])
    }
    try {
      setChat(await api.sendChat(projectPath, shotId, prompterId, message))
    } catch (e) {
      setError(errorMessage(e))
      setChat(await api.getChat(projectPath, shotId))
    } finally {
      setBusy(false)
    }
  }

  const attach = (files: InputFile[]): void => setAttached((a) => [...a, ...files.filter((f) => !a.some((x) => x.name === f.name))])
  const canSend = !!prompter && !busy && (!!text.trim() || attached.length > 0)
  const submit = (): void => {
    if (canSend) void send({ text: text.trim(), images: attached.map((f) => f.name) })
  }

  if (prompters && !prompters.length) {
    return (
      <Empty title="No LLM prompter yet" actions={<><Button variant="primary" onClick={() => go({ name: 'library', tab: 'prompters' })}>Open Library</Button><Button onClick={onClose}>Close</Button></>}>
        The chat talks to an LLM prompter. Create one in Library &gt; Prompters and give it the prompting skill for this workflow.
      </Empty>
    )
  }

  return (
    <Card className="flex h-[calc(100vh-15rem)] min-h-[440px] flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <span className="shrink-0 font-semibold">Prompt chat</span>
        <Select className="h-9 min-w-0 flex-1" aria-label="Prompter" value={prompterId ?? ''} onChange={(e) => {
          setPrompterId(Number(e.target.value))
          localStorage.setItem(LAST_PROMPTER, e.target.value)
        }}>
          {(prompters ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.config.type === 'llm' && p.config.llm.skill ? ` · ${p.config.llm.skill}` : ''}</option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" disabled={!messages.length || busy} onClick={async () => {
          if (!confirm('Clear this shot\'s chat? The messages are deleted; attached images stay in the project.')) return
          await api.clearChat(projectPath, shotId)
          setError(null)
          setChat({ messages: [], files: {} })
        }}>Clear chat</Button>
        <Button size="sm" variant="ghost" aria-label="Close prompt chat" onClick={onClose}>×</Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin">
        {!messages.length && (
          <div className="px-2 py-6 text-13 text-text2">
            <div className="font-semibold text-text">Work out this shot's prompt</div>
            <p className="mt-1.5">Describe the shot, attach its reference images in the order the workflow takes them, and ask for a prompt. After a render, come back and say what to change.</p>
            <p className="mt-1.5">
              {skill ? <>The <span className="font-mono">{skill}</span> skill is read in full with every message.</> : 'This prompter has no prompting skill; it only follows its instruction.'}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={m.id} className="ml-8 self-end rounded-lg bg-tint px-3 py-2">
                {m.images.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {m.images.map((name, j) => (
                      <ImageChip key={name + j} projectPath={projectPath} name={name} label={`Image ${firstImage.at[i] + j}`} title={chat?.files[name]?.originalName} />
                    ))}
                  </div>
                )}
                {m.text && <Markdown>{m.text}</Markdown>}
              </div>
            ) : (
              <Reply key={m.id} text={m.text} useLabel={listMode ? 'Add to prompt list' : 'Use as prompt'} onUse={onUsePrompt}
                onCopy={(t) => void api.copyText(t).then(() => toast('Copied.'))} />
            )
          )}
          {busy && live && <Reply text={live} />}
          {busy && (
            <div className="flex items-center gap-2 text-13 text-text2">
              <Spinner /> {live ? 'Writing…' : 'Waiting for the reply…'}
              <Button size="sm" variant="ghost" onClick={() => void api.stopChat(projectPath, shotId)}>Stop</Button>
            </div>
          )}
          {error && !busy && <div className="rounded-md bg-dtint px-3 py-2 text-13 text-danger">{error}</div>}
          {/* The last message has no reply: it failed, was stopped, or the app closed while waiting. */}
          {waiting && !busy && chat && <div><Button size="sm" disabled={!prompter} onClick={() => void send(null)}>Try again</Button></div>}
        </div>
        <div ref={end} />
      </div>

      <div
        className={cn('border-t border-border p-3', over && 'bg-tint')}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setOver(false)
          try {
            const added: InputFile[] = []
            for (const f of Array.from(e.dataTransfer.files)) added.push(await api.addInputFromPath(projectPath, window.toolkit.pathForFile(f)))
            attach(added)
          } catch (err) {
            toast(errorMessage(err), 'error')
          }
        }}
      >
        {attached.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attached.map((f, j) => (
              <ImageChip key={f.name} projectPath={projectPath} name={f.name} label={`Image ${firstImage.next + j}`} title={f.originalName}
                onRemove={() => setAttached((a) => a.filter((x) => x.name !== f.name))} />
            ))}
          </div>
        )}
        <Textarea
          rows={3}
          className="text-13"
          value={text}
          placeholder={messages.length ? 'What should change?' : 'Describe the shot…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={async () => attach(await api.pickImages(projectPath, true))}>Add images</Button>
          <Button size="sm" disabled={!shotImages.length} title="Attach the images in the shot's form, in the workflow's order" onClick={() => attach(shotImages)}>
            Shot's images{shotImages.length ? ` (${shotImages.length})` : ''}
          </Button>
          <Button size="sm" disabled={!currentPrompt.trim()} title="Paste the shot's current prompt into the message"
            onClick={() => setText((t) => `${t.trim() ? `${t.trimEnd()}\n\n` : ''}Current prompt:\n\`\`\`\n${currentPrompt.trim()}\n\`\`\`\n`)}>
            Quote prompt
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="primary" disabled={!canSend} onClick={submit}>Send</Button>
        </div>
        <div className="mt-1.5 text-xs text-muted">Enter sends, Shift+Enter starts a new line. Messages and images go to the prompter's endpoint, not to the ComfyUI server.</div>
      </div>
    </Card>
  )
}

/** An assistant message: prose, and a card per prompt block. Without `onUse` (still being written) the cards have no actions. */
function Reply({ text, useLabel, onUse, onCopy }: { text: string; useLabel?: string; onUse?: (t: string) => void; onCopy?: (t: string) => void }): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      {splitReply(text).map((p, j) =>
        p.type === 'text' ? (
          <Markdown key={j} className="text-text2">{p.text}</Markdown>
        ) : (
          <div key={j} className="rounded-md border border-border bg-stripe">
            <div className={cn('p-3 font-mono text-xs break-words whitespace-pre-wrap', onUse && 'max-h-72 overflow-y-auto scroll-thin')}>{p.text}</div>
            {onUse && (
              <div className="flex gap-2 border-t border-border px-3 py-2">
                <Button size="sm" variant="primary" onClick={() => onUse(p.text)}>{useLabel}</Button>
                <Button size="sm" onClick={() => onCopy?.(p.text)}>Copy</Button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}

function ImageChip({ projectPath, name, label, title, onRemove }: { projectPath: string; name: string; label: string; title?: string; onRemove?: () => void }): ReactNode {
  return (
    <div className="media relative size-16 overflow-hidden rounded-md border border-border" title={title ?? name}>
      <img src={media(projectPath, `inputs/${name}`)} alt={title ?? name} className="size-full object-cover" />
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/55 px-1 font-mono text-10 text-white">{label}</span>
      {onRemove && (
        <button aria-label={`Remove ${label}`} onClick={onRemove}
          className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full border border-control bg-panel text-xs text-text">
          ×
        </button>
      )}
    </div>
  )
}
