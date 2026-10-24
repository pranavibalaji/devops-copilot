import React from 'react'
import { Plus, Cpu } from 'lucide-react'

interface TopHeaderProps {
  title: string
  onOpenTriggerModal: () => void
  decisionProvider?: string
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  title,
  onOpenTriggerModal,
  decisionProvider = 'groq',
}) => {
  return (
    <header className="top-header">
      <div className="header-left">
        <h1 className="header-title">{title}</h1>
        <div className="header-tag">
          <Cpu size={13} style={{ color: '#252525' }} />
          <span>Decision: {decisionProvider.toUpperCase()}</span>
        </div>
      </div>

      <div className="header-right">
        <button className="btn btn-primary" onClick={onOpenTriggerModal}>
          <Plus size={15} />
          <span>Simulate Incident</span>
        </button>
      </div>
    </header>
  )
}
