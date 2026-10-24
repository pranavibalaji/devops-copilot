import { BrainCircuit, CheckCircle2, CircleHelp, ServerCog, ShieldCheck } from 'lucide-react'
import type { Incident } from '../types/incident'

interface DecisionExplanationPanelProps {
  incident: Incident
}

const displayValue = (value?: string | number | null) => {
  if (value === undefined || value === null || value === '') return 'Not available'
  return String(value)
}

export const DecisionExplanationPanel: React.FC<DecisionExplanationPanelProps> = ({ incident }) => {
  const decision = incident.decision
  const deploymentEntries = Object.entries(incident.evidence?.deployment_history || {})
  const logs = incident.evidence?.logs || []
  const isMockDecision = decision?.provider?.toLowerCase() === 'mock'
  const providerLabel = decision?.provider || 'Not available'

  const explanation = decision?.root_cause
    ? `The recorded root cause links this incident to: ${decision.root_cause}`
    : decision?.hypothesis
      ? `The recorded hypothesis is: ${decision.hypothesis}`
      : 'The workflow has not produced a decision explanation yet.'

  return (
    <section className="explanation-panel" aria-labelledby="decision-explanation-title">
      <div className="explanation-heading">
        <div>
          <div className="eyebrow"><BrainCircuit size={14} /> Explainable decision</div>
          <h3 id="decision-explanation-title">Why this recommendation was selected</h3>
        </div>
        <span className={`provider-label ${isMockDecision ? 'provider-label-mock' : ''}`}>
          {isMockDecision ? 'MOCK-GENERATED DECISION' : `PROVIDER: ${providerLabel.toUpperCase()}`}
        </span>
      </div>

      <p className="explanation-intro">{explanation}</p>

      <div className="decision-facts-grid">
        <div className="decision-fact">
          <CircleHelp size={16} aria-hidden="true" />
          <div><span>Hypothesis</span><strong>{displayValue(decision?.hypothesis)}</strong></div>
        </div>
        <div className="decision-fact">
          <ShieldCheck size={16} aria-hidden="true" />
          <div><span>Recommended action</span><strong>{displayValue(decision?.recommended_action).toUpperCase()}</strong></div>
        </div>
        <div className="decision-fact">
          <CheckCircle2 size={16} aria-hidden="true" />
          <div><span>Approval status</span><strong>{displayValue(incident.approval?.status).toUpperCase()}</strong></div>
        </div>
        <div className="decision-fact">
          <BrainCircuit size={16} aria-hidden="true" />
          <div>
            <span>Confidence score</span>
            <strong>{typeof decision?.confidence === 'number' ? `${(decision.confidence * 100).toFixed(0)}%` : 'Not available'}</strong>
          </div>
        </div>
      </div>

      <div className="decision-evidence-row">
        <div>
          <span className="evidence-label"><ServerCog size={14} /> Recent deployment evidence</span>
          {deploymentEntries.length > 0 ? (
            <ul className="compact-evidence-list">
              {deploymentEntries.map(([service, deployment]) => (
                <li key={service}><strong>{service}</strong>: {displayValue(deployment.version)}; previous {displayValue(deployment.previous_version)}</li>
              ))}
            </ul>
          ) : <p>Not available.</p>}
        </div>
        <div>
          <span className="evidence-label"><ServerCog size={14} /> Collected evidence</span>
          {logs.length > 0 ? (
            <ul className="compact-evidence-list">
              {logs.slice(0, 3).map((log, index) => <li key={`${log.timestamp}-${index}`}>{log.message}</li>)}
            </ul>
          ) : <p>Not available.</p>}
        </div>
      </div>

      <p className="decision-disclaimer">The confidence score is an aid for review, not a guarantee that the recommendation is correct. Human approval remains the control point before remediation.</p>
    </section>
  )
}
