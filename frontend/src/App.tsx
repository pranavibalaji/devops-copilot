import React, { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { TopHeader } from './components/TopHeader'
import { TriggerModal } from './components/TriggerModal'
import { DashboardOverview } from './components/DashboardOverview'
import { IncidentDetails } from './components/IncidentDetails'
import { IncidentsList } from './components/IncidentsList'
import { RunbooksPage } from './components/RunbooksPage'
import { MemoryPage } from './components/MemoryPage'
import { AnalyticsDashboard } from './components/AnalyticsDashboard'
import type { Incident, SystemStatus } from './types/incident'
import { fetchHealth, fetchIncidents } from './lib/api'

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('dashboard')
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState<boolean>(false)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [activeIncidents, setActiveIncidents] = useState<Incident[]>([])
  const [pastIncidents, setPastIncidents] = useState<any[]>([])

  // Load health & incidents periodically
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const h = await fetchHealth()
        setSystemStatus(h)
      } catch (err) {
        console.error('Health fetch error:', err)
      }
    }

    const loadIncidentsList = async () => {
      try {
        const data = await fetchIncidents()
        setActiveIncidents(data.active || [])
        setPastIncidents(data.past || [])
      } catch (err) {
        console.error('Incidents list fetch error:', err)
      }
    }

    loadStatus()
    loadIncidentsList()

    const statusInterval = setInterval(loadStatus, 5000)
    const incidentsInterval = setInterval(loadIncidentsList, 3000)

    return () => {
      clearInterval(statusInterval)
      clearInterval(incidentsInterval)
    }
  }, [])

  const handleSelectIncident = (id: string) => {
    setSelectedIncidentId(id)
  }

  const handleIncidentCreated = (id: string) => {
    setSelectedIncidentId(id)
    fetchIncidents().then((d) => {
      setActiveIncidents(d.active || [])
      setPastIncidents(d.past || [])
    })
  }

  const handleTabChange = (tab: string) => {
    setCurrentTab(tab)
    setSelectedIncidentId(null)
  }

  const getPageTitle = () => {
    if (selectedIncidentId) return `Incident ${selectedIncidentId}`
    switch (currentTab) {
      case 'dashboard':
        return 'Overview'
      case 'incidents':
        return 'Incident Records'
      case 'analytics':
        return 'Incident Analytics'
      case 'runbooks':
        return 'Runbook Documentation'
      case 'memory':
        return 'ChromaDB Incident Memory'
      default:
        return 'Incident Agent'
    }
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <Sidebar
        currentTab={selectedIncidentId ? 'incidents' : currentTab}
        setCurrentTab={handleTabChange}
        status={systemStatus}
      />

      {/* Main Wrapper */}
      <div className="main-wrapper">
        <TopHeader
          title={getPageTitle()}
          onOpenTriggerModal={() => setIsTriggerModalOpen(true)}
          decisionProvider={systemStatus?.decision_provider || 'groq'}
        />

        <main className="content-body">
          {selectedIncidentId ? (
            <IncidentDetails
              incidentId={selectedIncidentId}
              onBack={() => setSelectedIncidentId(null)}
            />
          ) : currentTab === 'dashboard' ? (
            <DashboardOverview
              incidents={activeIncidents}
              pastIncidents={pastIncidents}
              status={systemStatus}
              onOpenTriggerModal={() => setIsTriggerModalOpen(true)}
              onSelectIncident={handleSelectIncident}
              onViewAllIncidents={() => setCurrentTab('incidents')}
            />
          ) : currentTab === 'incidents' ? (
            <IncidentsList
              incidents={activeIncidents}
              pastIncidents={pastIncidents}
              onSelectIncident={handleSelectIncident}
            />
          ) : currentTab === 'analytics' ? (
            <AnalyticsDashboard
              incidents={activeIncidents}
              pastIncidents={pastIncidents}
            />
          ) : currentTab === 'runbooks' ? (
            <RunbooksPage />
          ) : currentTab === 'memory' ? (
            <MemoryPage />
          ) : null}
        </main>
      </div>

      {/* Trigger Incident Modal */}
      <TriggerModal
        isOpen={isTriggerModalOpen}
        onClose={() => setIsTriggerModalOpen(false)}
        onIncidentCreated={handleIncidentCreated}
      />
    </div>
  )
}

export default App
