import React, { useState, useEffect, useMemo, useRef } from 'react'
import AuditView from '../components/AuditView'
import ChatView from '../components/ChatView'
import './ContractViewerPage.css'

const TABS = [
  { id: 'read', label: 'Read' },
  { id: 'audit', label: 'Audit' },
  { id: 'chat', label: 'Chat' },
  { id: 'amend', label: 'Amend' },
  { id: 'history', label: 'History' },
]

// Detects section headers in both markdown and raw legal contracts (SEC EDGAR, MSAs, SOWs)
function detectSectionHeader(trimmed) {
  if (!trimmed || trimmed.length < 3 || trimmed.length > 95) return null

  if (trimmed.startsWith('#')) {
    const title = trimmed.replace(/^#+\s*/, '')
    if (title.length > 2) {
      return {
        title,
        level: trimmed.startsWith('###') ? 3 : trimmed.startsWith('##') ? 2 : 1,
      }
    }
  }

  // Legal headings: SECTION, ARTICLE, CLAUSE (e.g. ARTICLE I DEFINITIONS, Section 2.1 Transferred IP)
  if (/^(?:SECTION|ARTICLE|CLAUSE)\s+[\dIVXLCDM]+(?:\.[\d]+)*/i.test(trimmed)) {
    return { title: trimmed, level: 2 }
  }

  // Numbered legal headings (e.g. 1. MANUFACTURING OUTSOURCING SERVICES, 2. COMPONENTS PURCHASING...)
  if (/^\d+\.\s+[A-Z][A-Za-z0-9\s,/\-\(\)\'\".:;]{2,85}$/.test(trimmed)) {
    return { title: trimmed, level: 2 }
  }

  // Major contract divisions: EXHIBIT, SCHEDULE, RECITALS, PREAMBLE
  if (/^(?:EXHIBIT|SCHEDULE)\s+[A-Z0-9.]+/i.test(trimmed) || /^(?:RECITALS|PREAMBLE)/i.test(trimmed)) {
    return { title: trimmed, level: 2 }
  }

  return null
}

export default function ContractViewerPage({ contractId, initialTab = 'read', onBack }) {
  const [contract, setContract] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState(initialTab)
  const [remediationDraft, setRemediationDraft] = useState('')

  const handleTabChange = (newTab) => {
    setActiveTab(newTab)
    if (contractId) {
      window.history.replaceState({}, '', `#contracts/${contractId}/${newTab}`)
    }
  }

  // In-document search state
  const [docSearch, setDocSearch] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)

  // Section outline
  const [selectedSection, setSelectedSection] = useState('')
  const [showScrollTop, setShowScrollTop] = useState(false)
  const readerSheetRef = useRef(null)

  // Track window scrolling to toggle the "Back to Top" button
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 280)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    let isMounted = true
    async function fetchContract() {
      if (!contractId) return
      try {
        setLoading(true)
        const res = await fetch(`/api/contracts/${contractId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        const data = await res.json()
        if (isMounted) {
          setContract(data)
          setError(null)
        }
      } catch (err) {
        if (isMounted) {
          console.error('[ContractViewer] Error:', err)
          setError(err.message)
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    fetchContract()
    return () => {
      isMounted = false
    }
  }, [contractId])

  // Parse document sections for the outline dropdown
  const sections = useMemo(() => {
    if (!contract || !contract.content) return []
    const lines = contract.content.split('\n')
    const list = []
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      const detected = detectSectionHeader(trimmed)
      if (detected) {
        list.push({
          id: `section-${index}`,
          title: detected.title.slice(0, 65),
          lineIndex: index,
        })
      }
    })
    return list
  }, [contract])

  // Count search matches whenever docSearch or contract content changes
  useEffect(() => {
    if (!docSearch.trim() || !contract?.content) {
      setTotalMatches(0)
      setCurrentMatch(0)
      return
    }
    const regex = new RegExp(docSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const matches = contract.content.match(regex)
    const count = matches ? matches.length : 0
    setTotalMatches(count)
    setCurrentMatch(count > 0 ? 1 : 0)
  }, [docSearch, contract])

  // Scroll active match into view
  useEffect(() => {
    if (currentMatch > 0) {
      const activeEl = document.getElementById(`doc-match-${currentMatch - 1}`)
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [currentMatch])

  const handleNextMatch = () => {
    if (totalMatches === 0) return
    setCurrentMatch((prev) => (prev >= totalMatches ? 1 : prev + 1))
  }

  const handlePrevMatch = () => {
    if (totalMatches === 0) return
    setCurrentMatch((prev) => (prev <= 1 ? totalMatches : prev - 1))
  }

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        handlePrevMatch()
      } else {
        handleNextMatch()
      }
    }
  }

  const handleJumpToSection = (sectionId) => {
    setSelectedSection(sectionId)
    if (!sectionId) return
    if (sectionId === '__top__') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const el = document.getElementById(sectionId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleDownloadDocx = () => {
    if (!contractId) return
    window.location.href = `/api/contracts/${contractId}/export`
  }

  const handlePrint = () => {
    window.print()
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

  // Render text blocks with section IDs, inline markdown (bold/italic), and search highlighting
  const renderedContent = useMemo(() => {
    if (!contract || !contract.content) return null

    const lines = contract.content.split('\n')
    let matchCounter = 0
    const query = docSearch.trim()
    const regex = query ? new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi') : null

    const highlightText = (text, keyPrefix = '') => {
      if (!regex) return text
      const parts = text.split(regex)
      return parts.map((part, i) => {
        if (regex.test(part)) {
          const thisMatchIndex = matchCounter++
          const isActive = thisMatchIndex === currentMatch - 1
          return (
            <mark
              key={`${keyPrefix}-m-${i}`}
              id={`doc-match-${thisMatchIndex}`}
              className={`search-match ${isActive ? 'active-match' : ''}`}
            >
              {part}
            </mark>
          )
        }
        return part
      })
    }

    // Helper to parse **bold** and *italic* markdown inline
    const renderInlineMarkdown = (text, keyPrefix = '') => {
      if (!text) return null
      // Split into **bold** tokens
      const boldTokens = text.split(/(\*\*[^*]+\*\*)/g)
      return boldTokens.map((boldTok, bIdx) => {
        if (boldTok.startsWith('**') && boldTok.endsWith('**') && boldTok.length > 4) {
          const innerBold = boldTok.slice(2, -2)
          return (
            <strong key={`${keyPrefix}-b-${bIdx}`}>
              {highlightText(innerBold, `${keyPrefix}-b-${bIdx}`)}
            </strong>
          )
        }
        // Split into *italic* tokens
        const italicTokens = boldTok.split(/(\*[^*]+\*)/g)
        return italicTokens.map((italTok, iIdx) => {
          if (italTok.startsWith('*') && italTok.endsWith('*') && italTok.length > 2) {
            const innerItalic = italTok.slice(1, -1)
            return (
              <em key={`${keyPrefix}-it-${bIdx}-${iIdx}`}>
                {highlightText(innerItalic, `${keyPrefix}-it-${bIdx}-${iIdx}`)}
              </em>
            )
          }
          return highlightText(italTok, `${keyPrefix}-txt-${bIdx}-${iIdx}`)
        })
      })
    }

    const elements = []
    let currentParagraph = []
    let inList = false
    let listItems = []

    const flushParagraph = (key) => {
      if (currentParagraph.length > 0) {
        elements.push(
          <p key={`p-${key}`}>
            {renderInlineMarkdown(currentParagraph.join(' '), `p-${key}`)}
          </p>
        )
        currentParagraph = []
      }
    }

    const flushList = (key) => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`ul-${key}`}>
            {listItems.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item, `ul-${key}-${idx}`)}</li>
            ))}
          </ul>
        )
        listItems = []
        inList = false
      }
    }

    lines.forEach((line, index) => {
      const trimmed = line.trim()

      if (!trimmed) {
        flushParagraph(index)
        flushList(index)
        return
      }

      if (trimmed === '---') {
        flushParagraph(index)
        flushList(index)
        elements.push(<hr key={`hr-${index}`} />)
        return
      }

      // Check for headings (markdown or standard legal section headers)
      const secHeader = detectSectionHeader(trimmed)
      if (secHeader) {
        flushParagraph(index)
        flushList(index)
        if (secHeader.level === 1) {
          elements.push(
            <h1 key={`h1-${index}`} id={`section-${index}`} className="contract-heading-1">
              {renderInlineMarkdown(secHeader.title, `h1-${index}`)}
            </h1>
          )
        } else if (secHeader.level === 2) {
          elements.push(
            <h2 key={`h2-${index}`} id={`section-${index}`} className="contract-heading-2">
              {renderInlineMarkdown(secHeader.title, `h2-${index}`)}
            </h2>
          )
        } else {
          elements.push(
            <h3 key={`h3-${index}`} id={`section-${index}`} className="contract-heading-3">
              {renderInlineMarkdown(secHeader.title, `h3-${index}`)}
            </h3>
          )
        }
        return
      }

      // Check for bullet items
      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        flushParagraph(index)
        inList = true
        listItems.push(trimmed.replace(/^[*\-]\s*/, ''))
        return
      }

      // Otherwise regular line
      currentParagraph.push(trimmed)
    })

    flushParagraph('end')
    flushList('end')

    return elements
  }, [contract, docSearch, currentMatch])

  if (loading) {
    return (
      <main className="page-container contract-viewer">
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading contract document...
        </div>
      </main>
    )
  }

  if (error || !contract) {
    return (
      <main className="page-container contract-viewer">
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <p style={{ color: 'var(--status-risk-text)', marginBottom: '16px' }}>
            {error || 'Contract document not found.'}
          </p>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            ← Return to Contracts
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="page-container contract-viewer">
      {/* Top Header & Breadcrumb */}
      <section className="viewer-header">
        <div className="viewer-top-row">
          <button type="button" className="back-link" onClick={onBack}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Contracts</span>
          </button>

          {/* Header Actions: Print & Download .docx */}
          <div className="viewer-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePrint}
              title="Print document"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              <span>Print</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDownloadDocx}
              title="Download formatted Microsoft Word document"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download .docx</span>
            </button>
          </div>
        </div>

        {/* Title & Metadata row */}
        <div className="viewer-title-row">
          <h1 className="viewer-title">{contract.title}</h1>
          <div className="viewer-meta-chips">
            <span className="meta-chip">{contract.counterparty}</span>
            <span>·</span>
            <span className="meta-version">{contract.current_version || 'v1.0'}</span>
            <span>·</span>
            <span className={`status-badge ${getStatusBadgeClass(contract.status)}`}>
              {contract.status || 'Pending Review'}
            </span>
          </div>
        </div>

        {/* Tab Bar (Shared across Steps 4 to 8) */}
        <nav className="viewer-tabs" aria-label="Contract Views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`viewer-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </section>

      {/* Document Reader Container (Always printed in @media print regardless of activeTab) */}
      <section
        className={`reader-container ${activeTab !== 'read' ? 'print-only' : ''}`}
        aria-label="Document Reader"
      >
        {/* Reader Toolbar: only visible on screen when activeTab === 'read' */}
        {activeTab === 'read' && (
          <div className="reader-toolbar">
            {/* Outline Navigator */}
            <div className="outline-navigator">
              <select
                className="outline-select"
                value={selectedSection}
                onChange={(e) => handleJumpToSection(e.target.value)}
              >
                <option value="">Jump to section...</option>
                <option value="__top__">↑ Top of Document</option>
                {sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.title}
                  </option>
                ))}
              </select>
            </div>

            {/* In-Document Search */}
            <div className="doc-search-bar">
              <input
                type="text"
                className="doc-search-input"
                placeholder="Find in document..."
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              {docSearch && (
                <span className="doc-match-count">
                  {totalMatches > 0 ? `${currentMatch} of ${totalMatches}` : '0 found'}
                </span>
              )}
              <button
                type="button"
                className="doc-search-btn"
                onClick={handlePrevMatch}
                disabled={totalMatches === 0}
                title="Previous match (Shift+Enter)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <button
                type="button"
                className="doc-search-btn"
                onClick={handleNextMatch}
                disabled={totalMatches === 0}
                title="Next match (Enter)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Centered White Paper Sheet (Prints always) */}
        <div className="reader-stage">
          <article className="paper-sheet paper-sheet-printable" ref={readerSheetRef}>
            {/* Elegant legal running header for print */}
            <div className="print-running-header">
              <div className="print-header-left">
                <span className="print-brand-tag">Contract Intelligence Agent · Legal Review</span>
                <span className="print-counterparty-tag">· {contract.counterparty}</span>
              </div>
              <div className="print-header-right">
                <span className="print-version-tag">Version {contract.current_version || 'v1.0'}</span>
                <span className="print-status-tag">· Status: {contract.status || 'Pending Review'}</span>
              </div>
            </div>

            <div className="paper-prose">
              {renderedContent}
            </div>
          </article>
        </div>
      </section>

      {/* Tab: Audit (Dedicated Compliance Review) */}
      {activeTab === 'audit' && (
        <div className="screen-only-tab">
          <AuditView
            contract={contract}
            onContractUpdate={(updatedData) => {
              setContract((prev) => ({
                ...prev,
                ...updatedData,
                // Ensure status and checklist items update parent view
                status: updatedData.status || prev.status,
                checklist_score: updatedData.checklist_score,
                checklist_items: updatedData.checklist_items,
                risk_flags: updatedData.risk_flags,
                metadata: updatedData.metadata,
                executive_summary: updatedData.executive_summary,
              }))
            }}
            onNavigateToAmend={(remediationText) => {
              setRemediationDraft(remediationText)
              handleTabChange('amend')
            }}
          />
        </div>
      )}

      {/* Tab: Chat (Step 6 Document Intelligence & Conflict Simulator) */}
      {activeTab === 'chat' && (
        <div className="screen-only-tab">
          <ChatView
            contract={contract}
            onNavigateToAmend={(instruction) => {
              setRemediationDraft(instruction)
              handleTabChange('amend')
            }}
          />
        </div>
      )}

      {/* Tab: Amend (Step 7 Shell) */}
      {activeTab === 'amend' && (
        <div className="tab-placeholder screen-only-tab">
          <div className="placeholder-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <h2 className="placeholder-title">Redline Studio with Approval Gate</h2>
          <p className="placeholder-desc">
            Natural-language drafting, visual diffs, and mandatory counsel approval before commit. Ready for Step 7.
          </p>
          {remediationDraft && (
            <div style={{ marginTop: '16px', maxWidth: '640px', width: '100%', textAlign: 'left', background: 'var(--bg-canvas)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                Auto-Remediation Draft Queued:
              </div>
              <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                {remediationDraft}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Tab: History (Step 8 Shell) */}
      {activeTab === 'history' && (
        <div className="tab-placeholder screen-only-tab">
          <div className="placeholder-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h2 className="placeholder-title">Version History & Rollback</h2>
          <p className="placeholder-desc">
            Git-style commit tree, clause-level diff inspection, and 1-click rollback snapshots. Ready for Step 8.
          </p>
        </div>
      )}
      {/* Floating Back to Top Button */}
      {showScrollTop && (
        <button
          type="button"
          className="btn-back-to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Back to top"
          aria-label="Scroll back to top"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
          <span>Top</span>
        </button>
      )}
    </main>
  )
}
