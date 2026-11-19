import React, { useState, useEffect } from 'react'
import './HomePage.css'

export default function HomePage({ onNavigate, onSelectContract }) {
  const [contracts, setContracts] = useState([])
  const [flaggedRisks, setFlaggedRisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      try {
        setLoading(true)
        const res = await fetch('/api/contracts')
        if (!res.ok) {
          throw new Error(`Failed to load contracts: ${res.statusText}`)
        }
        const data = await res.json()
        if (isMounted) {
          setContracts(data || [])
          // Look for any existing flagged risks across contracts
          const risks = []
          for (const item of (data || [])) {
            if (item.risk_flags && Array.isArray(item.risk_flags)) {
              for (const r of item.risk_flags) {
                risks.push({ ...r, contractTitle: item.title, contractId: item.id })
              }
            }
          }
          setFlaggedRisks(risks)
          setError(null)
        }
      } catch (err) {
        if (isMounted) {
          console.error('[Dashboard] Error fetching contracts:', err)
          setError(err.message)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadData()
    return () => {
      isMounted = false
    }
  }, [])

  // Calculate statistics from real data
  const totalContracts = contracts.length
  const pendingReviewCount = contracts.filter((c) => c.status === 'Pending Review').length
  const needsChangesCount = contracts.filter((c) => c.status === 'Needs Changes').length
  const completedCount = contracts.filter((c) => c.status === 'Completed').length

  // Top 5 recent contracts sorted by updated_at
  const recentContracts = [...contracts]
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .slice(0, 5)

  const handleRowClick = (contractId) => {
    if (onSelectContract) {
      onSelectContract(contractId)
    } else if (onNavigate) {
      onNavigate('contracts')
    }
  }

  const formatContractDate = (dateStr) => {
    if (!dateStr) return '—'
    try {
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return dateStr.split(' ')[0]
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    } catch {
      return dateStr
    }
  }

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Completed':
        return 'badge-completed'
      case 'Needs Changes':
        return 'badge-changes'
      case 'Pending Review':
      default:
        return 'badge-pending'
    }
  }

  return (
    <main className="page-container dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">Dashboard</h1>
      </div>

      {/* Row of 4 Compact Stat Tiles */}
      <section className="stats-strip" aria-label="Contract Summary Statistics">
        <div className="stat-tile">
          <span className="stat-value">{loading ? '—' : totalContracts}</span>
          <span className="stat-label">Total contracts</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{loading ? '—' : pendingReviewCount}</span>
          <span className="stat-label">Pending review</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{loading ? '—' : needsChangesCount}</span>
          <span className="stat-label">Needs changes</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{loading ? '—' : completedCount}</span>
          <span className="stat-label">Completed</span>
        </div>
      </section>

      {/* Main Grid: Recent Contracts (visual anchor) & Needs Attention Panel */}
      <div className="dashboard-grid">
        {/* Recent Contracts Table */}
        <section className="card-panel" aria-label="Recent Contracts">
          <div className="card-header">
            <h2 className="card-title">Recent contracts</h2>
            <button
              type="button"
              className="card-link"
              onClick={() => onNavigate && onNavigate('contracts')}
            >
              View all contracts
            </button>
          </div>

          <div className="table-wrapper">
            {loading ? (
              <div className="state-loading">Loading contracts...</div>
            ) : error ? (
              <div className="state-error">Unable to load contracts.</div>
            ) : recentContracts.length === 0 ? (
              <div className="state-loading">No contracts found.</div>
            ) : (
              <table className="contracts-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Counterparty</th>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentContracts.map((contract) => (
                    <tr
                      key={contract.id}
                      onClick={() => handleRowClick(contract.id)}
                      title="Click to view contract details"
                    >
                      <td className="cell-title">{contract.title}</td>
                      <td className="cell-counterparty">{contract.counterparty}</td>
                      <td className="cell-version">{contract.current_version || 'v1.0'}</td>
                      <td>
                        <span className={`status-badge ${getStatusBadgeClass(contract.status)}`}>
                          {contract.status || 'Active'}
                        </span>
                      </td>
                      <td className="cell-date">{formatContractDate(contract.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Needs Attention Panel */}
        <section className="card-panel" aria-label="Needs Attention">
          <div className="card-header">
            <h2 className="card-title">Needs attention</h2>
          </div>
          <div className="needs-attention-body">
            {flaggedRisks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <p className="empty-text">
                  Nothing flagged. Run an analysis on a contract to see risks here.
                </p>
              </div>
            ) : (
              <div className="risk-list">
                {flaggedRisks.map((risk, index) => (
                  <div key={index} className="risk-item">
                    <div className="risk-item-header">
                      <span className="risk-item-title">{risk.title}</span>
                      <span className="status-badge badge-action">{risk.severity}</span>
                    </div>
                    <span className="risk-item-contract">{risk.contractTitle} · {risk.clause_ref}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
