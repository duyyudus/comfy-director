import { useEffect, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { Button, Empty } from '../components/ui'

/** Landing inside a project: jumps to the first shot, or shows the next step. */
export function HomeView(): ReactNode {
  const { tree, setDialog, go, workflows } = useStore()
  const first = tree
    ? [...tree.shots].sort((a, b) => {
        const sa = a.sequenceId === null ? Infinity : tree.sequences.findIndex((s) => s.id === a.sequenceId)
        const sb = b.sequenceId === null ? Infinity : tree.sequences.findIndex((s) => s.id === b.sequenceId)
        return sa - sb || (a.position ?? 0) - (b.position ?? 0)
      })[0]
    : undefined
  useEffect(() => {
    if (first) go({ name: 'shot', shotId: first.id })
  }, [first, go])

  if (!tree) {
    return (
      <div className="p-10">
        <Empty title="No project open" actions={<Button variant="primary" onClick={() => setDialog({ kind: 'new-project' })}>New project</Button>}>
          A project is a folder of related work: sequences, shots, their renders and input images.
        </Empty>
      </div>
    )
  }
  if (first) return null
  return (
    <div className="p-10">
      <Empty
        title="Start your first shot"
        actions={
          <>
            <Button variant="primary" onClick={() => setDialog({ kind: 'new-shot', sequenceId: null })}>New shot</Button>
            <Button onClick={() => setDialog({ kind: 'new-sequence' })}>New sequence</Button>
            {!workflows.length && <Button onClick={() => go({ name: 'import', back: { name: 'home' } })}>Import a workflow</Button>}
          </>
        }
      >
        A shot is one moment of your video. Pick a workflow, fill in the inputs, and render attempts until one is right.
      </Empty>
    </div>
  )
}
