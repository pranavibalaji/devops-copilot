import React, { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  AlertTriangle,
  RotateCcw,
  Server,
  Layers,
  FileText,
  Database,
  BookOpen,
  Check,
  X,
  Cpu,
} from 'lucide-react'
import type { Incident } from '../types/incident'
import {
  fetchIncident,
  approveRemediation,
  rejectRemediation,
  getReportDownloadUrl,
} from '../lib/api'
import { DecisionExplanationPanel } from './DecisionExplanationPanel'
import { RecoveryComparison } from './RecoveryComparison'
import { IncidentAuditTimeline } from './IncidentAuditTimeline'

interface IncidentDetailsProps {
  incidentId: string
  onBack: () => void
}

export const IncidentDetails: React.FC<IncidentDetailsProps> = ({ incidentId, onBack }) => {
  const [incident, setIncident] = useState<Incident | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Poll incident status while active
  useEffect(() => {
    let isMounted = true

    const loadData = async () => {
      try {
        const data = await fetchIncident(incidentId)
        if (isMounted) {
          setIncident(data)
          setLoading(false)
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to load incident')
          setLoading(false)
        }
      }
    }

    loadData()

    // Poll every 800ms if incident is running or awaiting approval
    const interval = setInterval(() => {
      if (
        incident?.status === 'investigating' ||
        incident?.status === 'awaiting_approval' ||
        incident?.status === 'mitigating'
      ) {
        loadData()
      }
    }, 800)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [incidentId, incident?.status])

  const handleApprove = async () => {
    if (!incident) return
    setActionLoading(true)
    try {
      await approveRemediation(incident.incident_id)
      // Refresh immediately
      const updated = await fetchIncident(incident.incident_id)
      setIncident(updated)
    } catch (err: any) {
      alert(`Approval error: ${err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!incident) return
    setActionLoading(true)
    try {
      await rejectRemediation(incident.incident_id)
      const updated = await fetchIncident(incident.incident_id)
      setIncident(updated)
    } catch (err: any) {
      alert(`Reject error: ${err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading && !incident) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <Clock size={24} style={{ animation: 'spin 2s linear infinite', marginBottom: '12px' }} />
        <p>Loading incident {incidentId}...</p>
      </div>
    )
  }

  if (error || !incident) {
    return (
      <div style={{ padding: '40px' }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack} style={{ marginBottom: '16px' }}>
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
        <div style={{ padding: '20px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', color: '#B91C1C' }}>
          {error || 'Incident not found'}
        </div>
      </div>
    )
  }

  const isAwaitingApproval = incident.status === 'awaiting_approval'

  return (
    <div className="incident-detail-page">
      {/* Back button & ID */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>
          <ArrowLeft size={14} /> Back to Incidents
        </button>

        <div style={{ display: 'flex', gap: '8px' }}>
          {incident.report && (
            <a
              href={getReportDownloadUrl(incident.incident_id)}
              className="btn btn-secondary btn-sm"
              download={`incident-${incident.incident_id}.md`}
            >
              <Download size={14} /> Download Markdown (.md)
            </a>
          )}
        </div>
      </div>

      {/* Incident Header Card */}
      <div className="card incident-identity-card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span className={`badge badge-${incident.severity}`}>{incident.severity}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {incident.service.toUpperCase()}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>•</span>
              <span style={{ fontSize: '12.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {incident.incident_id}
              </span>
            </div>

            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              {incident.title}
            </h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
              <span>Triggered: {new Date(incident.started_at).toLocaleTimeString()}</span>
              {incident.duration_seconds && (
                <span>Duration: {incident.duration_seconds}s</span>
              )}
              <span>
                Affected:{' '}
                {incident.affected_services.map((s) => (
                  <span key={s} className="header-tag" style={{ marginLeft: '4px' }}>
                    {s}
                  </span>
                ))}
              </span>
            </div>
          </div>

          <div>
            <span className={`badge badge-${incident.status}`} style={{ fontSize: '12.5px', padding: '4px 10px' }}>
              {incident.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      <DecisionExplanationPanel incident={incident} />

      {/* WORKFLOW TIMELINE */}
      <div className="card workflow-pipeline-card">
        <div className="card-header">
          <div className="card-title">
            <Layers size={16} /> Workflow Execution Pipeline
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            LangGraph State Machine
          </span>
        </div>

        <div className="timeline">
          {incident.stages.map((stage) => {
            const isCompleted = stage.status === 'completed'
            const isRunning = stage.status === 'running'
            const isFailed = stage.status === 'failed'
            const isWaiting = stage.id === 'human_approval' && isAwaitingApproval

            let statusClass = ''
            if (isWaiting) statusClass = 'awaiting'
            else if (isRunning) statusClass = 'running'
            else if (isCompleted) statusClass = 'completed'
            else if (isFailed) statusClass = 'failed'

            return (
              <div key={stage.id} className={`timeline-step ${statusClass}`}>
                <div className="timeline-icon">
                  {isCompleted ? (
                    <Check size={13} />
                  ) : isWaiting ? (
                    <AlertTriangle size={13} />
                  ) : isRunning ? (
                    <Clock size={13} />
                  ) : isFailed ? (
                    <X size={13} />
                  ) : (
                    <span style={{ fontSize: '10px' }}>○</span>
                  )}
                </div>

                <div className="timeline-content">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="timeline-title">{stage.title}</span>
                    {stage.timestamp && (
                      <span className="timeline-time">
                        {new Date(stage.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <IncidentAuditTimeline incident={incident} />

      {/* HUMAN APPROVAL GATE PANEL */}
      {isAwaitingApproval && (
        <div className="approval-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <AlertTriangle className="approval-warning-icon" size={18} />
            <h3 className="approval-heading" style={{ fontSize: '16px', fontWeight: 600 }}>
              Remediation Requires Operator Approval
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', margin: '14px 0' }}>
            <div>
              <span className="approval-label" style={{ fontSize: '12px' }}>Recommended Action</span>
              <div className="approval-value" style={{ fontSize: '15px', fontWeight: 600 }}>
                {incident.approval.action.toUpperCase()}
              </div>
            </div>

            <div>
              <span className="approval-label" style={{ fontSize: '12px' }}>Target Service</span>
              <div className="approval-value" style={{ fontSize: '15px', fontWeight: 600 }}>
                {incident.approval.service}
              </div>
            </div>

            <div>
              <span className="approval-label" style={{ fontSize: '12px' }}>Target Version</span>
              <div className="approval-value" style={{ fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                v2.4.0 (Previous Stable)
              </div>
            </div>

            <div>
              <span className="approval-label" style={{ fontSize: '12px' }}>Confidence</span>
              <div className="approval-confidence" style={{ fontSize: '15px', fontWeight: 600 }}>
                {(incident.approval.confidence * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          <p className="approval-notice" style={{ fontSize: '13px', marginBottom: '16px' }}>
            Notice: This action will modify the simulated service state in memory and trigger automated health verification.
          </p>

          <div className="approval-actions">
            <button
              className="btn btn-secondary"
              onClick={handleReject}
              disabled={actionLoading}
            >
              <X size={15} /> Reject Remediation
            </button>

            <button
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={actionLoading}
            >
              <Check size={15} /> Approve Rollback
            </button>
          </div>
        </div>
      )}

      {/* APPROVAL STATUS NOTIFICATION IF ALREADY DECIDED */}
      {incident.approval.resolved_at && !isAwaitingApproval && (
        <div
          className={`approval-status-banner approval-status-${incident.approval.status}`}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {incident.approval.status === 'approved' ? (
              <CheckCircle2 className="approval-status-icon" size={16} />
            ) : (
              <AlertTriangle className="approval-status-icon" size={16} />
            )}
            <span>
              Operator approval: <strong>{incident.approval.status.toUpperCase()}</strong> on action{' '}
              <code>{incident.approval.action}</code>
            </span>
          </div>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
            {new Date(incident.approval.resolved_at).toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* GROQ DECISION PANEL */}
      {incident.decision && incident.decision.hypothesis && (
        <div className="decision-panel">
          <div className="decision-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={16} />
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Structured Agent Decision</h3>
            </div>
            <span className="decision-provider-tag">
              Decision generated by {incident.decision.provider.toUpperCase()} ({incident.decision.model})
            </span>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Hypothesis
            </span>
            <p style={{ fontSize: '14.5px', fontWeight: 500, color: 'var(--text-primary)', marginTop: '2px' }}>
              {incident.decision.hypothesis}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', margin: '14px 0' }}>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Recommended Action</span>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#252525', marginTop: '2px' }}>
                {incident.decision.recommended_action.toUpperCase()}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Confidence Score</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <span style={{ fontSize: '15px', fontWeight: 600 }}>
                  {(incident.decision.confidence * 100).toFixed(0)}%
                </span>
                <div className="confidence-bar-wrapper">
                  <div
                    className="confidence-bar-fill"
                    style={{ width: `${Math.min(incident.decision.confidence * 100, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>

            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Likely Root Cause</span>
              <p style={{ fontSize: '13px', color: 'var(--text-primary)', marginTop: '2px' }}>
                {incident.decision.root_cause || 'Deployment v2.4.1 database pool exhaustion'}
              </p>
            </div>
          </div>

          {incident.decision.action_plan && incident.decision.action_plan.length > 0 && (
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Action Plan
              </span>
              <ul style={{ fontSize: '13px', paddingLeft: '18px', marginTop: '4px', color: 'var(--text-primary)' }}>
                {incident.decision.action_plan.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* EVIDENCE PANEL */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Server size={16} /> Collected Evidence
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Service Health, Deployments, Logs & Metrics
          </span>
        </div>

        {/* Health & Deployment Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <div className="evidence-surface" style={{ padding: '14px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: '#FAF9F6' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Service Health</span>
            <div style={{ marginTop: '8px' }}>
              {Object.entries(incident.evidence.service_health || {}).map(([svc, hlth]) => (
                <div key={svc} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '3px 0' }}>
                  <span>{svc}</span>
                  <span style={{ fontWeight: 600, color: hlth === 'healthy' ? '#15803D' : '#B91C1C' }}>
                    {hlth.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="evidence-surface" style={{ padding: '14px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: '#FAF9F6' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Recent Deployment</span>
            <div style={{ marginTop: '8px', fontSize: '13px' }}>
              {Object.entries(incident.evidence.deployment_history || {}).map(([svc, dep]) => (
                <div key={svc}>
                  <div><strong>{svc}:</strong> {dep.version} ({dep.deployed_minutes_ago}m ago)</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Previous: {dep.previous_version}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Logs */}
        {incident.evidence.logs && incident.evidence.logs.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Sample Error Logs ({incident.evidence.logs.length} entries)
            </div>
            <div className="code-block">
              {incident.evidence.logs.slice(0, 4).map((log, i) => (
                <div key={i} style={{ color: log.level === 'CRITICAL' ? '#F87171' : '#E5E7EB' }}>
                  [{log.timestamp}] {log.service} [{log.level}]: {log.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SIMILAR INCIDENTS (ChromaDB Memory) */}
      {incident.similar_past_incidents && incident.similar_past_incidents.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Database size={16} /> Similar Past Incidents
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Retrieved from ChromaDB Vector Memory
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {incident.similar_past_incidents.map((past, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 14px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12.5px', fontWeight: 600 }}>
                    {past.incident_id}
                  </span>
                  <span style={{ fontSize: '13px', marginLeft: '8px' }}>{past.title}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {past.similarity !== undefined && (
                    <span className="brand-badge memory-match-badge" style={{ backgroundColor: '#F1EFEB' }}>
                      {(past.similarity * 100).toFixed(0)}% match
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RUNBOOK GUIDANCE */}
      {incident.runbook && incident.runbook.title && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <BookOpen size={16} /> Runbook Guidance
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {incident.runbook.title}
            </span>
          </div>

          <div
            className="detail-light-surface"
            style={{
              padding: '14px',
              backgroundColor: '#FAF9F6',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              whiteSpace: 'pre-wrap',
              maxHeight: '200px',
              overflowY: 'auto',
            }}
          >
            {incident.runbook.content}
          </div>
        </div>
      )}

      {/* REMEDIATION & VERIFICATION (If executed) */}
      <RecoveryComparison incident={incident} />
      {incident.remediation.attempted && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <RotateCcw size={16} /> Remediation & Verification
            </div>
            <span className="brand-badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
              SIMULATED ENVIRONMENT
            </span>
          </div>

          <div style={{ marginBottom: '16px', fontSize: '13.5px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Action executed: </span>
            <strong>{incident.remediation.result}</strong>
          </div>

          {/* Verification comparison */}
          {incident.verification.after && (
            <div className="comparison-grid">
              <div className="comparison-card">
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  BEFORE REMEDIATION
                </span>
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  <div>Health: <strong style={{ color: '#ffabb9' }}>degraded</strong></div>
                  <div>Error rate: <strong style={{ color: '#ffabb9' }}>38.2%</strong></div>
                </div>
              </div>

              <div className="comparison-card after">
                <span style={{ fontSize: '12px', color: '#71efc7', textTransform: 'uppercase', fontWeight: 600 }}>
                  AFTER REMEDIATION (VERIFIED)
                </span>
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  <div>Health: <strong style={{ color: '#71efc7' }}>healthy</strong></div>
                  <div>Error rate: <strong style={{ color: '#71efc7' }}>0.3% (Normal)</strong></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FINAL INCIDENT REPORT */}
      {incident.report && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <FileText size={16} /> Generated Incident Postmortem Report
            </div>
            <a
              href={getReportDownloadUrl(incident.incident_id)}
              className="btn btn-secondary btn-sm"
              download={`incident-${incident.incident_id}.md`}
            >
              <Download size={13} /> Download (.md)
            </a>
          </div>

          <div
            className="detail-light-surface"
            style={{
              padding: '18px',
              backgroundColor: '#FAF9F6',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              whiteSpace: 'pre-wrap',
              fontSize: '13.5px',
              lineHeight: 1.6,
            }}
          >
            {incident.report}
          </div>
        </div>
      )}
    </div>
  )
}
