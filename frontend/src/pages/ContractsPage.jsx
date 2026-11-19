import React, { useState, useEffect, useRef } from 'react'
import './ContractsPage.css'

const CATEGORIES = ['All', 'SOW', 'MSA', 'SaaS', 'Privacy', 'SEC Filings']

export default function ContractsPage({ onSelectContract }) {
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [openMenuId, setOpenMenuId] = useState(null)
  const menuRef = useRef(null)

  useEffect(() => {
    let isMounted = true
    async function fetchContracts() {
      try {
        setLoading(true)
        const res = await fetch('/api/contracts')
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        const data = await res.json()
        if (isMounted) {
          setContracts(data || [])
          setError(null)
        }
      } catch (err) {
        if (isMounted) {
          console.error('[ContractsPage] Error loading contracts:', err)
          setError(err.message)
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    fetchContracts()
    return () => {
      isMounted = false
    }
  }, [])

  // Close overflow menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenuId(null)
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const matchesCategory = (contract, category) => {
    if (category === 'All') return true
    const type = (contract.contract_type || '').toLowerCase()
    const id = (contract.id || '').toLowerCase()
    const title = (contract.title || '').toLowerCase()

    if (category === 'SOW') {
      return id.startsWith('sow_') || type.includes('sow') || type.includes('statement of work')
    }
    if (category === 'MSA') {
      return (id.startsWith('msa_') || type.includes('msa') || type.includes('master services')) && !id.startsWith('sec_')
    }
    if (category === 'SaaS') {
      return id.startsWith('saas_') || type.includes('saas') || type.includes('subscription')
    }
    if (category === 'Privacy') {
      return id.startsWith('dpa_') || id.startsWith('nda_') || type.includes('privacy') || type.includes('dpa') || type.includes('nda')
    }
    if (category === 'SEC Filings') {
      return id.startsWith('sec_') || title.includes('sec edgar') || type.includes('sec')
    }
    return true
  }

  // Filtered contracts list
  const filteredContracts = contracts.filter((c) => {
    const matchesCat = matchesCategory(c, activeCategory)
    if (!matchesCat) return false
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase().trim()
    return (
      (c.title || '').toLowerCase().includes(q) ||
      (c.counterparty || '').toLowerCase().includes(q) ||
      (c.id || '').toLowerCase().includes(q) ||
      (c.contract_type || '').toLowerCase().includes(q)
    )
  })

  // Count items per category
  const categoryCounts = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = contracts.filter((c) => matchesCategory(c, cat)).length
    return acc
  }, {})

  const handleAction = (e, contractId, actionTab) => {
    e.stopPropagation()
    setOpenMenuId(null)
    if (actionTab === 'download') {
      window.location.href = `/api/contracts/${contractId}/export`
      return
    }
    if (onSelectContract) {
      onSelectContract(contractId, actionTab)
    }
  }

  const renderAuditBadge = (score) => {
    if (!score || score === 'Pending Analysis') {
      return <span className="audit-badge audit-not-analyzed">Not Analyzed</span>
    }
    if (score.includes('Passed')) {
      return <span className="audit-badge audit-passed">{score}</span>
    }
    return <span className="audit-badge audit-flagged">{score}</span>
  }

  return (
    <main className="page-container contracts-page">
      {/* Page Title */}
      <div className="contracts-header">
        <h1 className="contracts-page-title">
          Contracts
          <span className="contracts-count">({filteredContracts.length})</span>
        </h1>
      </div>

      {/* Controls Bar: Search & Category Filter Pills */}
      <div className="controls-bar">
        {/* Search Input */}
        <div className="search-box">
          <span className="search-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            className="search-input"
            placeholder="Search by title, counterparty, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Category Pills */}
        <div className="filter-pills" role="tablist" aria-label="Category Filters">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`filter-pill ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
              <span className="pill-count">({categoryCounts[cat] || 0})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Compact Data Table */}
      <section className="repo-table-container" aria-label="Contracts Catalog">
        <div className="repo-table-wrapper">
          {loading ? (
            <div className="table-empty">Loading contracts repository...</div>
          ) : error ? (
            <div className="table-empty">Error loading repository: {error}</div>
          ) : filteredContracts.length === 0 ? (
            <div className="table-empty">No contracts match your search or filter.</div>
          ) : (
            <table className="repo-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Counterparty</th>
                  <th>Type</th>
                  <th>Version</th>
                  <th>Audit status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredContracts.map((contract) => (
                  <tr
                    key={contract.id}
                    onClick={() => onSelectContract && onSelectContract(contract.id, 'read')}
                  >
                    <td className="col-title" title={contract.title}>
                      {contract.title}
                    </td>
                    <td className="col-counterparty" title={contract.counterparty}>
                      {contract.counterparty}
                    </td>
                    <td className="col-type" title={contract.contract_type}>
                      {contract.contract_type}
                    </td>
                    <td className="col-version">
                      {contract.current_version || 'v1.0'}
                    </td>
                    <td>
                      {renderAuditBadge(contract.checklist_score)}
                    </td>
                    <td className="col-actions">
                      <div className="action-cluster" onClick={(e) => e.stopPropagation()}>
                        {/* Primary Single Action: View */}
                        <button
                          type="button"
                          className="btn-view"
                          onClick={(e) => handleAction(e, contract.id, 'read')}
                          title="View contract document"
                        >
                          View
                        </button>

                        {/* Overflow Menu Action: ⋯ */}
                        <div style={{ position: 'relative' }}>
                          <button
                            type="button"
                            className={`btn-overflow ${openMenuId === contract.id ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenMenuId(openMenuId === contract.id ? null : contract.id)
                            }}
                            title="More actions"
                            aria-haspopup="true"
                            aria-expanded={openMenuId === contract.id}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                              <circle cx="5" cy="12" r="1.5" />
                            </svg>
                          </button>

                          {/* Floating Overflow Dropdown */}
                          {openMenuId === contract.id && (
                            <div className="overflow-dropdown" ref={menuRef}>
                              <button
                                type="button"
                                className="overflow-item"
                                onClick={(e) => handleAction(e, contract.id, 'audit')}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M9 11l3 3L22 4" />
                                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                                </svg>
                                <span>Analyze Checklist</span>
                              </button>
                              <button
                                type="button"
                                className="overflow-item"
                                onClick={(e) => handleAction(e, contract.id, 'chat')}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                                <span>Document Chat</span>
                              </button>
                              <button
                                type="button"
                                className="overflow-item"
                                onClick={(e) => handleAction(e, contract.id, 'amend')}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                                <span>Amend & Redline</span>
                              </button>
                              <button
                                type="button"
                                className="overflow-item"
                                onClick={(e) => handleAction(e, contract.id, 'history')}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <circle cx="12" cy="12" r="10" />
                                  <polyline points="12 6 12 12 16 14" />
                                </svg>
                                <span>Version History</span>
                              </button>
                              <div className="overflow-divider" />
                              <button
                                type="button"
                                className="overflow-item"
                                onClick={(e) => handleAction(e, contract.id, 'download')}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                  <polyline points="7 10 12 15 17 10" />
                                  <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                <span>Download .docx</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  )
}
