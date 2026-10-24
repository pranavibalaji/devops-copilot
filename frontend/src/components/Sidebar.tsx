import React from 'react'
import { Activity, AlertOctagon, BarChart3, BookOpen, Database, ShieldAlert } from 'lucide-react'
import type { SystemStatus } from '../types/incident'

interface SidebarProps {
  currentTab: string
  setCurrentTab: (tab: string) => void
  status: SystemStatus | null
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, setCurrentTab, status }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-icon">
            <ShieldAlert size={16} />
          </div>
          <span className="brand-text">Incident Agent</span>
        </div>
        <span className="brand-badge">v2.0</span>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-link ${currentTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setCurrentTab('dashboard')}
        >
          <Activity size={16} />
          <span>Overview</span>
        </button>

        <button
          className={`nav-link ${currentTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setCurrentTab('incidents')}
        >
          <AlertOctagon size={16} />
          <span>Incidents</span>
        </button>

        <button
          className={`nav-link ${currentTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setCurrentTab('analytics')}
        >
          <BarChart3 size={16} />
          <span>Analytics</span>
        </button>

        <button
          className={`nav-link ${currentTab === 'runbooks' ? 'active' : ''}`}
          onClick={() => setCurrentTab('runbooks')}
        >
          <BookOpen size={16} />
          <span>Runbooks</span>
        </button>

        <button
          className={`nav-link ${currentTab === 'memory' ? 'active' : ''}`}
          onClick={() => setCurrentTab('memory')}
        >
          <Database size={16} />
          <span>Incident Memory</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="status-box">
          <div className="status-title">
            <span>System Status</span>
            <span style={{ fontSize: '10px', color: '#15803D' }}>
              {status?.status === 'healthy' ? 'HEALTHY' : 'READY'}
            </span>
          </div>

          <div className="status-item">
            <span>FastAPI</span>
            <span className="status-indicator">
              <span className={`status-dot ${status?.api === 'operational' ? 'operational' : 'disconnected'}`}></span>
              <span>{status?.api || 'Operational'}</span>
            </span>
          </div>

          <div className="status-item">
            <span>Redis</span>
            <span className="status-indicator">
              <span className={`status-dot ${status?.redis === 'connected' ? 'connected' : 'disconnected'}`}></span>
              <span>{status?.redis === 'connected' ? 'Connected' : 'Offline'}</span>
            </span>
          </div>

          <div className="status-item">
            <span>Groq</span>
            <span className="status-indicator">
              <span className={`status-dot ${status?.groq === 'connected' ? 'connected' : 'degraded'}`}></span>
              <span>{status?.groq === 'connected' ? 'Connected' : 'Configured'}</span>
            </span>
          </div>

          <div className="status-item">
            <span>ChromaDB</span>
            <span className="status-indicator">
              <span className={`status-dot ${status?.chromadb === 'connected' ? 'connected' : 'disconnected'}`}></span>
              <span>{status?.chromadb === 'connected' ? `${status.memory_incidents} items` : 'Offline'}</span>
            </span>
          </div>

          <div className="status-item">
            <span>Agent</span>
            <span className="status-indicator">
              <span className={`status-dot ${status?.agent === 'running' ? 'running' : 'ready'}`}></span>
              <span>{status?.agent === 'running' ? 'Running' : 'Ready'}</span>
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
