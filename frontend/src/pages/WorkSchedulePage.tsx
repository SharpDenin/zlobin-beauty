import { useSearchParams } from 'react-router-dom'
import { ScheduleEditor, type ScheduleEditorTab } from '@/features/schedule/ScheduleEditor'

function parseTab(raw: string | null): ScheduleEditorTab {
  if (raw === 'exception' || raw === 'modes' || raw === 'hours') return raw
  return 'hours'
}

/** Thin page wrapper — App redirects /schedule → /calendar?panel=schedule; this remains usable if linked directly. */
export function WorkSchedulePage() {
  const [params] = useSearchParams()
  return (
    <main className="page stack" data-testid="work-schedule-page">
      <ScheduleEditor
        tab={parseTab(params.get('tab'))}
        initialStart={params.get('start')}
        initialEnd={params.get('end')}
      />
    </main>
  )
}
