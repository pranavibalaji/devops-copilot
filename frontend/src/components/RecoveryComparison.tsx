import { ArrowRight, BadgeCheck, RotateCcw } from 'lucide-react'
import type { Incident } from '../types/incident'

interface RecoveryComparisonProps {
  incident: Incident
}

const readableValue = (value: string | number | undefined) => value === undefined || value === '' ? 'Not available' : String(value)

const healthTone = (value: string | undefined) => {
  if (value === 'healthy') return 'good'
  if (value === 'Not available' || !value) return 'neutral'
  return 'attention'
}

export const RecoveryComparison: React.FC<RecoveryComparisonProps> = ({ incident }) => {
  const before = incident.verification?.before || {}
  const after = incident.verification?.after || {}
  const hasVerificationData = Object.keys(before.service_health || {}).length > 0
    || Object.keys(after.service_health || {}).length > 0
    || Object.keys(before.error_rates || {}).length > 0
    || Object.keys(after.error_rates || {}).length > 0
  const services = Array.from(new Set([
    ...Object.keys(before.service_health || {}),
    ...Object.keys(after.service_health || {}),
    ...Object.keys(before.error_rates || {}),
    ...Object.keys(after.error_rates || {}),
    ...incident.affected_services,
  ]))

  if (!incident.remediation?.attempted && !hasVerificationData) return null

  return (
    <section className="recovery-comparison" aria-labelledby="recovery-comparison-title">
      <div className="comparison-heading">
        <div>
          <div className="eyebrow"><RotateCcw size={14} /> Simulated recovery</div>
          <h3 id="recovery-comparison-title">Before-and-after verification</h3>
        </div>
        <span className={`verification-badge ${incident.verification?.passed ? 'verification-passed' : 'verification-pending'}`}>
          <BadgeCheck size={14} /> {incident.verification?.passed ? 'VERIFICATION PASSED' : 'VERIFICATION NOT CONFIRMED'}
        </span>
      </div>

      <p className="comparison-action"><strong>Action:</strong> {readableValue(incident.remediation?.result)} <span>All values are from the simulated project environment.</span></p>

      {services.length > 0 ? services.map((service) => {
        const beforeHealth = before.service_health?.[service]
        const afterHealth = after.service_health?.[service]
        const beforeRate = before.error_rates?.[service]
        const afterRate = after.error_rates?.[service]
        return (
          <div className="service-comparison" key={service}>
            <div className="service-comparison-name">{service}</div>
            <div className="comparison-state comparison-state-before">
              <span>Before</span>
              <strong className={`state-${healthTone(beforeHealth)}`}>{readableValue(beforeHealth)}</strong>
              <small>Error rate: {readableValue(beforeRate)}</small>
            </div>
            <ArrowRight className="comparison-arrow" size={19} aria-hidden="true" />
            <div className="comparison-state comparison-state-after">
              <span>After</span>
              <strong className={`state-${healthTone(afterHealth)}`}>{readableValue(afterHealth)}</strong>
              <small>Error rate: {readableValue(afterRate)}</small>
            </div>
          </div>
        )
      }) : <p className="not-available">No before-and-after values are available for this incident.</p>}
    </section>
  )
}
