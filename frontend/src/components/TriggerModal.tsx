import React, { useState } from 'react'
import { X, Play, Sparkles } from 'lucide-react'
import { triggerIncident } from '../lib/api'

interface TriggerModalProps {
  isOpen: boolean
  onClose: () => void
  onIncidentCreated: (incidentId: string) => void
}

const PRESETS = [
  {
    id: 'p1_checkout',
    label: 'P1 — Checkout deployment failure (Recommended)',
    title: 'High error rate on checkout-service',
    service: 'checkout-service',
    severity: 'P1',
    metric: 'error_rate',
    value: '8.3%',
    threshold: '1%',
    affected_services: ['checkout-service', 'payment-gateway'],
  },
  {
    id: 'p0_auth',
    label: 'P0 — Auth outage (High Severity)',
    title: 'auth-service complete outage — all regions',
    service: 'auth-service',
    severity: 'P0',
    metric: 'availability',
    value: '0%',
    threshold: '99.9%',
    affected_services: ['auth-service', 'api-gateway'],
  },
  {
    id: 'p2_search',
    label: 'P2 — Search latency elevated',
    title: 'Search latency elevated — eu-west-1',
    service: 'search-service',
    severity: 'P2',
    metric: 'p99_latency_ms',
    value: '4200',
    threshold: '500',
    affected_services: ['search-service'],
  },
]

export const TriggerModal: React.FC<TriggerModalProps> = ({
  isOpen,
  onClose,
  onIncidentCreated,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<string>('p1_checkout')
  const [title, setTitle] = useState(PRESETS[0].title)
  const [service, setService] = useState(PRESETS[0].service)
  const [severity, setSeverity] = useState(PRESETS[0].severity)
  const [metric, setMetric] = useState(PRESETS[0].metric)
  const [value, setValue] = useState(PRESETS[0].value)
  const [threshold, setThreshold] = useState(PRESETS[0].threshold)
  const [affectedServices, setAffectedServices] = useState(PRESETS[0].affected_services.join(', '))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId)
    const preset = PRESETS.find((p) => p.id === presetId)
    if (preset) {
      setTitle(preset.title)
      setService(preset.service)
      setSeverity(preset.severity)
      setMetric(preset.metric)
      setValue(preset.value)
      setThreshold(preset.threshold)
      setAffectedServices(preset.affected_services.join(', '))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const affected = affectedServices
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const result = await triggerIncident({
        title,
        service,
        severity,
        metric,
        value,
        threshold,
        affected_services: affected.length > 0 ? affected : [service],
      })

      onIncidentCreated(result.incident_id)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to trigger incident')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Simulate Production Incident</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Triggers the live LangGraph agent workflow using the configured decision provider
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  borderRadius: 'var(--radius-md)',
                  color: '#B91C1C',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">
                <Sparkles size={13} style={{ display: 'inline', marginRight: '4px' }} />
                Demo Scenario Preset
              </label>
              <select
                className="form-select"
                value={selectedPreset}
                onChange={(e) => handlePresetChange(e.target.value)}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Alert Message / Title</label>
              <input
                className="form-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Primary Service</label>
                <input
                  className="form-input"
                  type="text"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Severity</label>
                <select
                  className="form-select"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  <option value="P0">P0 (Critical)</option>
                  <option value="P1">P1 (High)</option>
                  <option value="P2">P2 (Medium)</option>
                  <option value="P3">P3 (Low)</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Affected Services (comma-separated)</label>
              <input
                className="form-input"
                type="text"
                value={affectedServices}
                onChange={(e) => setAffectedServices(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Metric</label>
                <input
                  className="form-input"
                  type="text"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Current Value</label>
                <input
                  className="form-input"
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Threshold</label>
                <input
                  className="form-input"
                  type="text"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              <Play size={14} />
              <span>{loading ? 'Triggering...' : 'Trigger Incident'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
