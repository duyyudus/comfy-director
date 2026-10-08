import { useState, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { Button, Card } from '../components/ui'
import { ServerForm } from './SettingsView'
import { ImportView } from './ImportView'
import { ProjectNameField } from '../components/Dialogs'

const STEPS = ['Connect', 'Import a workflow', 'First project']

export function FirstLaunch(): ReactNode {
  const { settings, setSettings, workflows, projects, loadProjects, openProject, toast } = useStore()
  const [step, setStep] = useState(settings?.serverUrl ? (workflows.length ? 2 : 1) : 0)
  const [name, setName] = useState('')

  const finish = async (): Promise<void> => {
    await api.finishSetup()
    setSettings(await api.getSettings())
  }

  return (
    <div className="h-full overflow-y-auto bg-bg scroll-thin">
      <div className="mx-auto max-w-[1180px] px-6 py-10">
        <div className="mb-2 text-center text-[24px] font-semibold">Comfy Toolkit</div>
        <div className="mb-8 flex items-center justify-center gap-6">
          {STEPS.map((s, i) => (
            <div key={s} className={cn('flex items-center gap-2', i === step ? 'font-semibold' : 'text-text2')}>
              <span className={cn('flex size-6 items-center justify-center rounded-full text-xs',
                i < step ? 'border border-control' : i === step ? 'bg-accent text-white' : 'border border-control')}>
                {i < step ? '✓' : i + 1}
              </span>
              {s}
            </div>
          ))}
        </div>

        {step === 0 && (
          <Card className="mx-auto max-w-[520px] p-6">
            <div className="mb-4 text-[17px] font-semibold">Connect to ComfyUI</div>
            <ServerForm saveLabel="Continue" onSaved={() => setStep(1)} />
            <button className="mt-4 text-[13px] text-text2 hover:underline" onClick={() => setStep(1)}>Set the server later</button>
          </Card>
        )}

        {step === 1 && (
          <Card className="p-6">
            <div className="mb-1 flex items-center">
              <div className="flex-1 text-[17px] font-semibold">Add your first workflow</div>
              <button className="text-[13px] text-text2 underline" onClick={() => setStep(2)}>Skip for now</button>
            </div>
            <div className="mb-5 text-[13px] text-text2">Its inputs become the form of every shot. You can import more later.</div>
            <ImportView back={null} embedded onDone={() => setStep(2)} />
          </Card>
        )}

        {step === 2 && (
          <Card className="mx-auto max-w-[520px] p-6">
            <div className="mb-4 text-[17px] font-semibold">Name your first project</div>
            {projects.length > 0 && (
              <div className="mb-4 rounded-md bg-stripe px-3 py-2.5 text-[13px] text-text2">
                This workspace already has {projects.length} project{projects.length === 1 ? '' : 's'}. <button className="underline" onClick={() => void finish()}>Use them</button>
              </div>
            )}
            <ProjectNameField value={name} onChange={setName} />
            <div className="mt-5 flex justify-end">
              <Button variant="primary" disabled={!name.trim()} onClick={async () => {
                try {
                  const p = await api.createProject(name)
                  await loadProjects()
                  await openProject(p.path)
                  await finish()
                } catch (e) {
                  toast(errorMessage(e), 'error')
                }
              }}>Create project</Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
