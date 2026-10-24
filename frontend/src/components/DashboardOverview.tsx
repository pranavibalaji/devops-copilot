import React from 'react'
import {
  AlertTriangle,
  Play,
  ArrowRight,
  CheckCircle2,
  Database,
  Cpu,
  Layers,
} from 'lucide-react'
import type { Incident, SystemStatus } from '../types/incident'
import { triggerTestIncident } from '../lib/api'
import { IncidentSummaryCards } from './IncidentSummaryCards'

interface DashboardOverviewProps {
  incidents: Incident[]
  pastIncidents: any[]
  status: SystemStatus | null
  onOpenTriggerModal: () => void
  onSelectIncident: (id: string) => void
  onViewAllIncidents: () => void
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  incidents,
  pastIncidents,
  status,
  onOpenTriggerModal,
  onSelectIncident,
  onViewAllIncidents,
}) => {
  const [launchingDemo, setLaunchingDemo] = React.useState(false)

  const handleLaunchQuickDemo = async () => {
    setLaunchingDemo(true)
    try {
      const res = await triggerTestIncident('P1')
      onSelectIncident(res.incident_id)
    } catch (err: any) {
      alert(`Demo trigger error: ${err.message}`)
    } finally {
      setLaunchingDemo(false)
    }
  }

  const activeCount = incidents.filter(
    (i) => i.status === 'investigating' || i.status === 'awaiting_approval' || i.status === 'mitigating'
  ).length

  return (
    <div className="dashboard-overview">
      {/* Top Banner */}
      <div
        className="card command-hero"
        style={{
          backgroundColor: '#FAF9F6',
          border: '1px solid var(--border-color)',
          padding: '28px',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Incident Response Console
            </h2>
            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', maxWidth: '650px' }}>
              Autonomous SRE agent investigating production anomalies with ChromaDB incident memory, runbook RAG, Groq structured reasoning, and human-in-the-loop verification.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={onViewAllIncidents}>
              View All Incidents
            </button>
            <button className="btn btn-primary" onClick={onOpenTriggerModal}>
              + Simulate Incident
            </button>
          </div>
        </div>
      </div>

      <IncidentSummaryCards incidents={incidents} pastIncidents={pastIncidents} />

      {/* KPI Stats Grid */}
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="card kpi-card" style={{ padding: '18px', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Active Incidents
            </span>
            <AlertTriangle size={16} style={{ color: activeCount > 0 ? '#B91C1C' : 'var(--text-muted)' }} />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {activeCount}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {incidents.filter((i) => i.status === 'awaiting_approval').length} awaiting operator approval
          </span>
        </div>

        <div className="card kpi-card" style={{ padding: '18px', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              ChromaDB Memory
            </span>
            <Database size={16} style={{ color: 'var(--text-muted)' }} />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {status?.memory_incidents ?? pastIncidents.length}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Indexed past incidents for RAG matching
          </span>
        </div>

        <div className="card kpi-card" style={{ padding: '18px', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Decision Provider
            </span>
            <Cpu size={16} style={{ color: '#15803D' }} />
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {status?.decision_provider?.toUpperCase() || 'Not available'}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {status ? 'Configured decision provider' : 'Waiting for backend health'}
          </span>
        </div>

        <div className="card kpi-card" style={{ padding: '18px', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Backend Health
            </span>
            <CheckCircle2 size={16} style={{ color: '#15803D' }} />
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#15803D' }}>
            {status?.status === 'healthy' ? 'Operational' : 'Ready'}
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {status?.status === 'healthy' ? 'Redis and memory reachable' : 'Waiting for a healthy backend'}
          </span>
        </div>
      </div>

      {/* QUICK DEMO TRIGGER CARD */}
      <div
        className="quick-demo-card"
        style={{
          border: '1px solid #D5D1C8',
          borderLeft: '4px solid #252525',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: '#FFFFFF',
          padding: '20px 24px',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span className="badge badge-P1">P1 DEMO</span>
            <strong style={{ fontSize: '15px' }}>Checkout Deployment Failure</strong>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Simulate <code>checkout-service</code> high error rate (8.3%) caused by deployment v2.4.1. Tests full pipeline: Evidence → ChromaDB → Decision → Human Approval → Rollback → Verification.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleLaunchQuickDemo}
          disabled={launchingDemo}
        >
          <Play size={14} />
          <span>{launchingDemo ? 'Starting...' : 'Launch Demo Incident'}</span>
        </button>
      </div>

      {/* RECENT INCIDENTS TABLE */}
      <div className="card recent-incidents-card">
        <div className="card-header">
          <div className="card-title">
            <Layers size={16} /> Recent Incidents
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onViewAllIncidents}
          >
            <span>View All</span> <ArrowRight size={13} />
          </button>
        </div>

        {incidents.length === 0 && pastIncidents.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13.5px' }}>
            No active incidents. Click "+ Simulate Incident" or "Launch Demo Incident" above.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Incident ID</th>
                  <th>Service</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Recommended Action</th>
                  <th>Confidence</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {incidents.slice(0, 8).map((inc) => (
                  <tr key={inc.incident_id} onClick={() => onSelectIncident(inc.incident_id)}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{inc.incident_id}</td>
                    <td>{inc.service}</td>
                    <td>
                      <span className={`badge badge-${inc.severity}`}>{inc.severity}</span>
                    </td>
                    <td>
                      <span className={`badge badge-${inc.status}`}>
                        {inc.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>
                      {inc.decision?.recommended_action?.toUpperCase() || inc.approval?.action?.toUpperCase() || '—'}
                    </td>
                    <td>
                      {inc.decision?.confidence ? `${(inc.decision.confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                      {new Date(inc.started_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
