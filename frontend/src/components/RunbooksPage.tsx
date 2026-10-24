import React, { useEffect, useState } from 'react'
import { BookOpen, FileText, X } from 'lucide-react'
import type { RunbookSummary } from '../types/incident'
import { fetchRunbooks, fetchRunbook } from '../lib/api'

export const RunbooksPage: React.FC = () => {
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRunbook, setSelectedRunbook] = useState<{ filename: string; content: string } | null>(null)

  useEffect(() => {
    fetchRunbooks()
      .then((data) => {
        setRunbooks(data.runbooks)
        setLoading(false)
      })
      .catch((err) => {
        console.error(err)
        setLoading(false)
      })
  }, [])

  const handleSelectRunbook = async (filename: string) => {
    try {
      const data = await fetchRunbook(filename)
      setSelectedRunbook(data)
    } catch (err) {
      console.error(err)
    }
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading runbooks...</div>
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '24px', padding: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '6px' }}>Runbook Library</h2>
        <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
          Operational standard operating procedures embedded into ChromaDB for semantic retrieval during incident triage.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        {runbooks.map((rb) => (
          <div
            key={rb.filename}
            className="card"
            style={{
              padding: '20px',
              cursor: 'pointer',
              transition: 'border-color 0.15s ease',
            }}
            onClick={() => handleSelectRunbook(rb.filename)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <BookOpen size={16} style={{ color: '#252525' }} />
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>{rb.title}</h3>
            </div>

            <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: '8px' }}>
              runbooks/{rb.filename}
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {rb.summary || 'Operational diagnostic and recovery procedures.'}
            </p>
          </div>
        ))}
      </div>

      {/* Reader Modal */}
      {selectedRunbook && (
        <div className="modal-overlay" onClick={() => setSelectedRunbook(null)}>
          <div
            className="modal-dialog runbook-modal"
            style={{ maxWidth: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={16} />
                <h3 style={{ fontSize: '15px', fontWeight: 600 }}>runbooks/{selectedRunbook.filename}</h3>
              </div>
              <button
                className="runbook-close"
                onClick={() => setSelectedRunbook(null)}
                aria-label="Close runbook"
              >
                <X size={18} />
              </button>
            </div>

            <div className="runbook-reader">
              <pre
                className="runbook-reader-content"
              >
                {selectedRunbook.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
