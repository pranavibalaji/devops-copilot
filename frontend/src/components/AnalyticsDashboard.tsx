import { useMemo, useState } from 'react'
import {
  Activity,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  Clock3,
  Filter,
  PieChart,
  ShieldAlert,
} from 'lucide-react'
import type { Incident } from '../types/incident'

type PastIncident = {
  incident_id?: string
  severity?: string
  status?: string
  service?: string
  occurred_at?: string
  duration_seconds?: number
  remediation?: { attempted?: boolean }
  verification?: { passed?: boolean; before?: Incident['verification']['before']; after?: Incident['verification']['after'] }
}

type AnalyticsRecord = {
  id: string
  severity: string
  status?: string
  service?: string
  createdAt?: string
  memoryStoredAt?: string
  resolvedAt?: string
  durationSeconds?: number | null
  source: 'active' | 'memory'
  remediationAttempted: boolean
  verificationPassed?: boolean
  verification?: Incident['verification']
}

type Slice = { label: string; value: number; color: string }

const severityColors: Record<string, string> = { P0: '#ff7892', P1: '#ffb18f', P2: '#ffd174', P3: '#70caff' }
const statusLabels: Record<string, string> = {
  investigating: 'Open / investigating',
  awaiting_approval: 'Awaiting approval',
  mitigating: 'In progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
  escalated: 'Escalated',
  error: 'Error',
}
const statusColors: Record<string, string> = {
  investigating: '#75c8ff', awaiting_approval: '#ffd174', mitigating: '#9c94ff', resolved: '#59e3be',
  rejected: '#ff9fae', escalated: '#ff9fae', error: '#ff7892',
}

const dateFrom = (value?: string) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const knownService = (value?: string) => {
  const service = value?.trim()
  return service && service.toLowerCase() !== 'unknown' ? service : undefined
}

const recordTimestamp = (record: AnalyticsRecord) => dateFrom(record.source === 'active' ? record.createdAt : record.memoryStoredAt)

const recordedResolutionDuration = (record: AnalyticsRecord) => {
  if (record.source !== 'active' || record.status !== 'resolved') return null
  if (typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds) && record.durationSeconds >= 0) return record.durationSeconds
  const startedAt = dateFrom(record.createdAt)?.getTime()
  const resolvedAt = dateFrom(record.resolvedAt)?.getTime()
  return startedAt !== undefined && resolvedAt !== undefined && resolvedAt >= startedAt ? (resolvedAt - startedAt) / 1000 : null
}

const durationLabel = (seconds: number) => {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

const numericValue = (value?: string | number) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (!value) return null
  const parsed = Number.parseFloat(value.replace('%', '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

const DonutChart: React.FC<{ title: string; slices: Slice[]; subtitle: string; empty?: string }> = ({ title, slices, subtitle, empty }) => {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const segments = slices.filter((slice) => slice.value > 0).reduce<Array<Slice & { offset: number; portion: number }>>((items, slice) => {
    const offset = items.reduce((sum, item) => sum + item.portion, 0)
    items.push({ ...slice, offset, portion: (slice.value / total) * 100 })
    return items
  }, [])

  return (
    <section className="analytics-card analytics-chart-card">
      <div className="analytics-card-heading"><div><h3>{title}</h3><p>{subtitle}</p></div><PieChart size={18} /></div>
      {total === 0 ? <EmptyState message={empty || 'No matching incident records.'} /> : (
        <div className="donut-layout">
          <div className="donut-wrap" aria-label={`${title}: ${total} records`}>
            <svg className="donut-chart" viewBox="0 0 42 42" role="img">
              <circle className="donut-track" cx="21" cy="21" r="15.9155" />
              {segments.map((slice) => {
                const segment = <circle key={slice.label} className="donut-segment" cx="21" cy="21" r="15.9155" stroke={slice.color} strokeDasharray={`${slice.portion} ${100 - slice.portion}`} strokeDashoffset={-slice.offset}>
                  <title>{`${slice.label}: ${slice.value}`}</title>
                </circle>
                return segment
              })}
            </svg>
            <div className="donut-center"><strong>{total}</strong><span>records</span></div>
          </div>
          <div className="chart-legend">
            {slices.map((slice) => <div className="legend-row" key={slice.label} title={`${slice.label}: ${slice.value}`}><i style={{ background: slice.color }} /><span>{slice.label}</span><strong>{slice.value}</strong></div>)}
          </div>
        </div>
      )}
    </section>
  )
}

const HorizontalBars: React.FC<{ title: string; subtitle: string; slices: Slice[]; empty: string }> = ({ title, subtitle, slices, empty }) => {
  const max = Math.max(...slices.map((slice) => slice.value), 0)
  return (
    <section className="analytics-card analytics-chart-card">
      <div className="analytics-card-heading"><div><h3>{title}</h3><p>{subtitle}</p></div><BarChart3 size={18} /></div>
      {max === 0 ? <EmptyState message={empty} /> : <div className="horizontal-bars">
        {slices.map((slice) => <div className="bar-row" key={slice.label} title={`${slice.label}: ${slice.value}`}>
          <span>{slice.label}</span><div className="bar-track"><i style={{ width: `${(slice.value / max) * 100}%`, background: slice.color }} /></div><strong>{slice.value}</strong>
        </div>)}
      </div>}
    </section>
  )
}

const EmptyState: React.FC<{ message: string }> = ({ message }) => <div className="analytics-empty"><Activity size={17} /><span>{message}</span></div>

const TrendChart: React.FC<{ points: Array<{ label: string; value: number }> }> = ({ points }) => {
  const max = Math.max(...points.map((point) => point.value), 1)
  const width = 480
  const height = 178
  const padding = 26
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (points.length - 1)
    const y = height - padding - ((point.value / max) * (height - padding * 2))
    return { ...point, x, y }
  })
  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const area = `${path} L ${coordinates.at(-1)?.x ?? 0} ${height - padding} L ${coordinates[0]?.x ?? 0} ${height - padding} Z`

  return <section className="analytics-card analytics-trend-card">
    <div className="analytics-card-heading"><div><h3>Incident creation trend</h3><p>Daily counts from active workflows with a valid creation timestamp.</p></div><Activity size={18} /></div>
    {points.length === 0 ? <EmptyState message="No active workflow creation timestamps match these filters. Historical memory timestamps are storage times, not incident creation times." /> : <>
      <div className="trend-canvas"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Incident counts grouped by date">
        <line className="trend-gridline" x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <path className="trend-area" d={area} /><path className="trend-line" d={path} />
        {coordinates.map((point) => <g key={point.label}><circle className="trend-point" cx={point.x} cy={point.y} r="4"><title>{`${point.label}: ${point.value} incident${point.value === 1 ? '' : 's'}`}</title></circle><text x={point.x} y={height - 6} textAnchor="middle">{point.label}</text></g>)}
      </svg></div>
      <div className="trend-axis-label">Incident count per day · hover a point for the recorded count</div>
    </>}
  </section>
}

export const AnalyticsDashboard: React.FC<{ incidents: Incident[]; pastIncidents: PastIncident[] }> = ({ incidents, pastIncidents }) => {
  const [range, setRange] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [status, setStatus] = useState('all')
  const [service, setService] = useState('all')
  const [filterStart] = useState(() => Date.now())

  const records = useMemo(() => {
    const unique = new Map<string, AnalyticsRecord>()
    incidents.forEach((incident) => unique.set(incident.incident_id, {
      id: incident.incident_id, severity: incident.severity, status: incident.status, service: knownService(incident.service),
      createdAt: incident.started_at, resolvedAt: incident.resolved_at || undefined, durationSeconds: incident.duration_seconds, source: 'active',
      remediationAttempted: Boolean(incident.remediation?.attempted), verificationPassed: incident.verification?.passed,
      verification: incident.verification,
    }))
    pastIncidents.forEach((incident) => {
      if (!incident.incident_id || unique.has(incident.incident_id)) return
      unique.set(incident.incident_id, {
        // `status: resolved` is synthesized by the list endpoint for ChromaDB entries.
        // It is not a stored workflow outcome, so it must not feed status or resolution metrics.
        id: incident.incident_id, severity: incident.severity || 'P1', service: knownService(incident.service),
        memoryStoredAt: incident.occurred_at, source: 'memory',
        remediationAttempted: Boolean(incident.remediation?.attempted), verificationPassed: incident.verification?.passed,
      })
    })
    return Array.from(unique.values())
  }, [incidents, pastIncidents])

  const services = useMemo(() => Array.from(new Set(records.flatMap((record) => record.service ? [record.service] : []))).sort(), [records])
  const statuses = useMemo(() => Array.from(new Set(records.flatMap((record) => record.source === 'active' && record.status ? [record.status] : []))).sort(), [records])
  const filtered = useMemo(() => {
    const cutoff = range === 'all' ? null : new Date(filterStart - Number(range) * 24 * 60 * 60 * 1000)
    return records.filter((record) => {
      const date = recordTimestamp(record)
      return (severity === 'all' || record.severity === severity)
        && (status === 'all' || (record.source === 'active' && record.status === status))
        && (service === 'all' || record.service === service)
        && (!cutoff || (date !== null && date >= cutoff))
    })
  }, [records, range, severity, status, service, filterStart])

  const severitySlices = ['P0', 'P1', 'P2', 'P3'].map((key) => ({ label: key, value: filtered.filter((record) => record.severity === key).length, color: severityColors[key] }))
  const activeRecords = filtered.filter((record) => record.source === 'active')
  const statusSlices = statuses.map((key) => ({ label: statusLabels[key] || key, value: activeRecords.filter((record) => record.status === key).length, color: statusColors[key] || '#8da6c9' }))
  const serviceSlices = services.map((key) => ({ label: key, value: filtered.filter((record) => record.service === key).length, color: '#58d6ff' })).filter((slice) => slice.value > 0)
  const trendPoints = useMemo(() => {
    const dayCounts = new Map<string, number>()
    activeRecords.forEach((record) => { const date = dateFrom(record.createdAt); if (date) { const key = date.toISOString().slice(0, 10); dayCounts.set(key, (dayCounts.get(key) || 0) + 1) } })
    return Array.from(dayCounts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ label: new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value }))
  }, [activeRecords])
  const durations = activeRecords.map(recordedResolutionDuration).filter((value): value is number => value !== null)
  const averageDuration = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null
  const verifiedCount = activeRecords.filter((record) => record.remediationAttempted && record.verificationPassed === true).length
  const outcomes: Slice[] = [
    { label: 'Verified remediation', value: activeRecords.filter((record) => record.remediationAttempted && record.verificationPassed === true).length, color: '#59e3be' },
    { label: 'Unverified remediation', value: activeRecords.filter((record) => record.remediationAttempted && record.verificationPassed === false).length, color: '#ffd174' },
    { label: 'Awaiting decision', value: activeRecords.filter((record) => record.status === 'awaiting_approval').length, color: '#9c94ff' },
    { label: 'No remediation recorded', value: activeRecords.filter((record) => !record.remediationAttempted && record.status !== 'awaiting_approval').length, color: '#8da6c9' },
  ]
  const latestRecovery = useMemo(() => {
    const byService = new Map<string, AnalyticsRecord>()
    activeRecords.filter((record) => record.verification && (Object.keys(record.verification.before?.service_health || {}).length || Object.keys(record.verification.after?.service_health || {}).length)).forEach((record) => {
      const involved = new Set([...Object.keys(record.verification?.before?.service_health || {}), ...Object.keys(record.verification?.after?.service_health || {})])
      involved.forEach((name) => {
        const current = byService.get(name)
        const currentDate = dateFrom(current?.createdAt)?.getTime() || 0
        const recordDate = dateFrom(record.createdAt)?.getTime() || 0
        if (!current || recordDate >= currentDate) byService.set(name, record)
      })
    })
    return Array.from(byService.entries()).map(([name, record]) => ({ name, verification: record.verification! }))
  }, [activeRecords])

  return <div className="analytics-dashboard">
    <section className="analytics-hero">
      <div><span className="analytics-eyebrow"><BarChart3 size={14} /> Incident intelligence</span><h2>Operational analytics</h2><p>Charts use only recorded API fields. Historical ChromaDB entries are kept distinct from active workflows: their list-response status is synthesized, and their timestamps represent memory storage time rather than incident creation.</p><div className="analytics-source-summary"><span>{filtered.filter((record) => record.source === 'active').length} active workflows</span><span>{filtered.filter((record) => record.source === 'memory').length} ChromaDB memory entries</span></div></div>
      <div className="analytics-record-count"><strong>{filtered.length}</strong><span>matching records</span></div>
    </section>

    <section className="analytics-filters" aria-label="Analytics filters">
      <div className="filter-label"><Filter size={15} /> Filters</div>
      <label>Time range<select value={range} onChange={(event) => setRange(event.target.value)}><option value="all">All available</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
      <label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option>{['P0', 'P1', 'P2', 'P3'].map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
      <label>Workflow status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All workflow statuses</option>{statuses.map((key) => <option key={key} value={key}>{statusLabels[key] || key}</option>)}</select></label>
      <label>Primary service<select value={service} onChange={(event) => setService(event.target.value)}><option value="all">All services</option>{services.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
    </section>

    <section className="analytics-kpis">
      <div className="analytics-kpi"><span>Total records</span><strong>{filtered.length}</strong><small>Deduplicated active + memory records</small><Activity size={19} /></div>
      <div className="analytics-kpi analytics-kpi-good"><span>Resolved</span><strong>{activeRecords.filter((record) => record.status === 'resolved').length}</strong><small>Active workflows with a recorded resolved status</small><CheckCircle2 size={19} /></div>
      <div className="analytics-kpi analytics-kpi-warning"><span>Awaiting approval</span><strong>{activeRecords.filter((record) => record.status === 'awaiting_approval').length}</strong><small>Active workflows requiring operator action</small><Clock3 size={19} /></div>
      <div className="analytics-kpi analytics-kpi-critical"><span>P0 critical</span><strong>{filtered.filter((record) => record.severity === 'P0').length}</strong><small>Critical severity records</small><ShieldAlert size={19} /></div>
      <div className="analytics-kpi"><span>Average resolution time</span><strong>{averageDuration === null ? 'N/A' : durationLabel(averageDuration)}</strong><small>{durations.length ? `${durations.length} resolved workflow${durations.length === 1 ? '' : 's'} with a valid duration` : 'No valid resolved-workflow duration recorded'}</small><Clock3 size={19} /></div>
      <div className="analytics-kpi analytics-kpi-good"><span>Verified remediation</span><strong>{verifiedCount}</strong><small>Simulated workflow results only</small><BadgeCheck size={19} /></div>
    </section>

    <section className="analytics-grid analytics-grid-two">
      <DonutChart title="Severity distribution" subtitle="Counts by recorded priority across matching records." slices={severitySlices} />
      <DonutChart title="Workflow status distribution" subtitle="Actual active-workflow statuses only; memory entries have no stored outcome status." slices={statusSlices} empty="No active workflow status records match these filters." />
    </section>
    <TrendChart points={trendPoints} />
    <section className="analytics-grid analytics-grid-two">
      <HorizontalBars title="Incidents by primary service" subtitle="Only API-exposed primary-service values are counted. Historical list records omit their stored services metadata." slices={serviceSlices} empty="No API-exposed primary-service values match these filters." />
      <HorizontalBars title="Remediation outcomes" subtitle="Active workflow records only. Outcomes are simulated when recorded." slices={outcomes} empty="No active workflow outcomes match these filters. ChromaDB memory does not store remediation outcome flags." />
    </section>

    <section className="analytics-card recovery-analytics-card">
      <div className="analytics-card-heading"><div><h3>Service recovery snapshots</h3><p>Latest available before-and-after verification per service in the filtered active workflow records. All values are simulated.</p></div><BadgeCheck size={18} /></div>
      {latestRecovery.length === 0 ? <EmptyState message="No active-workflow verification snapshots are available for these filters. ChromaDB memory does not store recovery snapshots." /> : <div className="recovery-snapshot-grid">
        {latestRecovery.map(({ name, verification }) => {
          const beforeHealth = verification.before.service_health?.[name] || 'Not available'
          const afterHealth = verification.after.service_health?.[name] || 'Not available'
          const beforeRate = verification.before.error_rates?.[name]
          const afterRate = verification.after.error_rates?.[name]
          const beforeNumeric = numericValue(beforeRate)
          const afterNumeric = numericValue(afterRate)
          return <article className="recovery-snapshot" key={name}><h4>{name}</h4><div className="recovery-health"><span>Before <strong className={beforeHealth === 'healthy' ? 'health-good' : 'health-attention'}>{beforeHealth}</strong></span><span>After <strong className={afterHealth === 'healthy' ? 'health-good' : 'health-attention'}>{afterHealth}</strong></span></div><div className="rate-bars"><div><span>Before error rate</span><i><b style={{ width: beforeNumeric === null ? '0%' : `${Math.min(beforeNumeric, 100)}%` }} /></i><strong>{beforeRate ?? 'Not available'}</strong></div><div><span>After error rate</span><i><b className="after-rate" style={{ width: afterNumeric === null ? '0%' : `${Math.min(afterNumeric, 100)}%` }} /></i><strong>{afterRate ?? 'Not available'}</strong></div></div></article>
        })}
      </div>}
    </section>
  </div>
}
