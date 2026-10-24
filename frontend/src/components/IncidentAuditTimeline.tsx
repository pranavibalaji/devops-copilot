import { Check, Circle, Clock3, X } from 'lucide-react'
import type { Incident, StageItem } from '../types/incident'

interface IncidentAuditTimelineProps {
  incident: Incident
}

const iconForStatus = (status: StageItem['status']) => {
  if (status === 'completed') return <Check size={13} />
  if (status === 'failed') return <X size={13} />
  if (status === 'running') return <Clock3 size={13} />
  return <Circle size={11} />
}

const formatTime = (timestamp?: string | null) => {
  if (!timestamp) return 'Timestamp not available'
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString()
}

export const IncidentAuditTimeline: React.FC<IncidentAuditTimelineProps> = ({ incident }) => {
  const stages = incident.stages || []

  return (
    <section className="audit-timeline-card" aria-labelledby="audit-timeline-title">
      <div className="audit-timeline-heading">
        <div>
          <div className="eyebrow"><Clock3 size={14} /> Incident audit trail</div>
          <h3 id="audit-timeline-title">Verified workflow events</h3>
        </div>
        <span>{stages.length} recorded stages</span>
      </div>
      <div className="audit-timeline">
        <div className="audit-event audit-event-completed">
          <span className="audit-event-icon"><Check size={13} /></span>
          <div><strong>Incident created</strong><small>{formatTime(incident.started_at)}</small></div>
        </div>
        {stages.map((stage) => (
          <div className={`audit-event audit-event-${stage.status}`} key={stage.id}>
            <span className="audit-event-icon">{iconForStatus(stage.status)}</span>
            <div>
              <strong>{stage.title}</strong>
              <small>{stage.status.replace('_', ' ')} · {formatTime(stage.timestamp)}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
