import { AlertTriangle, CheckCircle2, ClipboardList, ShieldAlert } from 'lucide-react'
import type { Incident } from '../types/incident'

interface IncidentSummaryCardsProps {
  incidents: Incident[]
  pastIncidents: Array<{ incident_id?: string; severity?: string; status?: string }>
}

type SummaryCard = {
  label: string
  value: number
  helper: string
  tone: 'neutral' | 'success' | 'warning' | 'critical'
  icon: typeof ClipboardList
}

export const IncidentSummaryCards: React.FC<IncidentSummaryCardsProps> = ({ incidents, pastIncidents }) => {
  const knownIncidents = new Map<string, { severity?: string; status?: string }>()

  incidents.forEach((incident) => {
    knownIncidents.set(incident.incident_id, incident)
  })
  pastIncidents.forEach((incident) => {
    if (incident.incident_id && !knownIncidents.has(incident.incident_id)) {
      knownIncidents.set(incident.incident_id, incident)
    }
  })

  const allIncidents = Array.from(knownIncidents.values())
  const awaitingApproval = incidents.filter((incident) => incident.status === 'awaiting_approval').length
  const resolved = allIncidents.filter((incident) => incident.status === 'resolved' || !('status' in incident)).length
  const critical = allIncidents.filter((incident) => incident.severity === 'P0').length

  const cards: SummaryCard[] = [
    {
      label: 'Total incidents',
      value: allIncidents.length,
      helper: 'Active and stored records',
      tone: 'neutral',
      icon: ClipboardList,
    },
    {
      label: 'Resolved incidents',
      value: resolved,
      helper: 'Completed incident records',
      tone: 'success',
      icon: CheckCircle2,
    },
    {
      label: 'Awaiting approval',
      value: awaitingApproval,
      helper: 'Needs an operator decision',
      tone: 'warning',
      icon: AlertTriangle,
    },
    {
      label: 'Critical incidents',
      value: critical,
      helper: 'P0 severity records',
      tone: 'critical',
      icon: ShieldAlert,
    },
  ]

  return (
    <section className="incident-summary-grid" aria-label="Incident summary">
      {cards.map(({ label, value, helper, tone, icon: Icon }) => (
        <div className={`summary-card summary-card-${tone}`} key={label}>
          <div className="summary-card-header">
            <span>{label}</span>
            <Icon size={17} aria-hidden="true" />
          </div>
          <strong className="summary-card-value">{value}</strong>
          <span className="summary-card-helper">{helper}</span>
        </div>
      ))}
    </section>
  )
}
