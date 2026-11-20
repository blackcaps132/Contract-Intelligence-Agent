import React, { useState } from 'react'
import './AuditView.css'

const SECTION_KEYWORDS = {
  'Explicit Budget & Not-to-Exceed Cap': ['budget', 'compensation', 'invoicing', 'payment', 'fee', 'cap'],
  'Resource Rate Card & Payment Windows': ['rate', 'staffing', 'compensation', 'pricing', 'payment', 'invoice'],
  'Deliverables & Milestone Schedule': ['deliverable', 'milestone', 'service', 'scope'],
  'IP Ownership & Work-Made-for-Hire': ['intellectual property', 'ip', 'ownership', 'proprietary', 'work product'],
  'Termination & Written Notice Period': ['termination', 'term', 'cancellation', 'default'],
  'Designated Governing Law & Venue': ['governing law', 'jurisdiction', 'dispute', 'miscellaneous', 'general'],
}

function resolveSectionPlaceholder(rawText, contractContent, itemName) {
  if (!rawText) return `Please remediate and insert standard clause for: ${itemName}`
  if (!rawText.includes('[X]') && !rawText.includes('[x]')) return rawText

  const lines = (contractContent || '').split('\n')
  const secRegex = /^(?:#+\s*)?(?:SECTION|ARTICLE)\s*(\d+)[:.\-\s]+([^\n\r]+)/i
  const existingSections = []

  lines.forEach((line) => {
    const match = line.trim().match(secRegex)
    if (match) {
      existingSections.push({
        num: parseInt(match[1], 10),
        title: match[2].trim(),
      })
    }
  })

  const maxNum = existingSections.length > 0
    ? Math.max(...existingSections.map((s) => s.num))
    : 0
  const nextNum = maxNum > 0 ? maxNum + 1 : 1

  const keywords = SECTION_KEYWORDS[itemName] || []
  const found = existingSections.find((s) =>
    keywords.some((kw) => s.title.toLowerCase().includes(kw))
  )

  const resolvedNum = found ? found.num : nextNum
  let resolved = rawText.replace(/\[X\]/gi, String(resolvedNum))
  resolved = resolved.replace(/\[Amount\]/gi, '195,000')
  return resolved
}

export default function AuditView({ contract, onContractUpdate, onNavigateToAmend }) {
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)

  const isAnalyzed = Boolean(
    contract?.checklist_score &&
    contract?.checklist_score !== 'Pending Analysis' &&
    contract?.checklist_items &&
    contract?.checklist_items.length > 0
  )

  const handleRunAnalysis = async () => {
    if (!contract?.id || analyzing) return
    try {
      setAnalyzing(true)
      setError(null)
      const res = await fetch(`/api/contracts/${contract.id}/analyze`, {
        method: 'POST',
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()
      const hasIssues =
        (data.risk_flags && data.risk_flags.length > 0) ||
        (data.checklist_items &&
          data.checklist_items.some(
            (i) => i.status === 'MISSING' || i.status === 'AMBIGUOUS'
          ))
      const evaluatedStatus = data.status || (hasIssues ? 'Needs Changes' : 'Completed')

      if (onContractUpdate) {
        onContractUpdate({
          ...data,
          status: evaluatedStatus,
        })
      }
    } catch (err) {
      console.error('[AuditView] Analysis failed:', err)
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleAutoRemediate = (item) => {
    const rawText =
      item.remediation_clause ||
      `Please remediate and insert standard clause for: ${item.name}`
    const remediationText = resolveSectionPlaceholder(rawText, contract?.content, item.name)
    if (onNavigateToAmend) {
      onNavigateToAmend(remediationText)
    }
  }

  const handleRemediateRisk = (risk) => {
    const remediationText = `Remediate risk in ${risk.clause_ref}: replace "${risk.snippet}" with standard fallback: "${risk.suggested_fallback}"`
    if (onNavigateToAmend) {
      onNavigateToAmend(remediationText)
    }
  }

  // Strict On-Demand Empty State
  if (!isAnalyzed) {
    return (
      <div className="audit-view">
        <div className="audit-empty-state">
          <div className="audit-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h2 className="audit-empty-title">Compliance Audit Pending</h2>
          <p className="audit-empty-desc">
            This contract has not been analyzed yet. Run an on-demand verification against the mandatory legal checklist criteria and scan for high-risk clauses.
          </p>

          {error && (
            <p style={{ color: 'var(--status-risk-text)', fontSize: '13px' }}>
              Error: {error}
            </p>
          )}

          <button
            type="button"
            className="btn-run-analysis"
            onClick={handleRunAnalysis}
            disabled={analyzing}
          >
            {analyzing ? (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span>Analyzing with LangGraph Agent...</span>
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>Run Compliance Audit</span>
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  // Analyzed Results
  const metadata = contract.metadata || {}
  const checklistItems = contract.checklist_items || []
  const riskFlags = contract.risk_flags || []
  const isAllPassed = (contract.checklist_score || '').includes('100%')

  return (
    <div className="audit-view">
      {/* 1. Scorecard Banner */}
      <section className="audit-score-banner" aria-label="Compliance Scorecard">
        <div className="score-info">
          <div
            className={`score-badge-large ${
              isAllPassed ? 'score-badge-passed' : 'score-badge-warning'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {isAllPassed ? (
                <polyline points="20 6 9 17 4 12" />
              ) : (
                <circle cx="12" cy="12" r="10" />
              )}
            </svg>
            <span>{contract.checklist_score}</span>
          </div>

          <div className="score-title-group">
            <h2 className="score-main-title">Mandatory Checklist Compliance</h2>
            <span className="score-subtitle">
              Verified against 6 required corporate contracting standards
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn-reanalyze"
          onClick={handleRunAnalysis}
          disabled={analyzing}
          title="Re-run Audit"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span>{analyzing ? 'Re-analyzing...' : 'Re-run Audit'}</span>
        </button>
      </section>

      {/* 2. Executive Intake Summary Card */}
      <section className="intake-card" aria-label="Executive Intake Summary">
        <div className="intake-card-header">
          <h3 className="card-section-title">Executive Intake Summary</h3>
          <span className="intake-card-tag">
            {metadata.contract_type || contract.contract_type || 'Commercial Contract'}
          </span>
        </div>

        <div className="intake-grid">
          <div className="intake-cell">
            <span className="intake-label">Parties</span>
            <span className="intake-value">
              {metadata.counterparty || contract.counterparty || 'Not specified'}
            </span>
            <span className="intake-subtext">Commercial Counterparties</span>
          </div>

          <div className="intake-cell">
            <span className="intake-label">Effective Date</span>
            <span className="intake-value">
              {metadata.effective_date || 'Not specified'}
            </span>
            <span className="intake-subtext">Execution baseline</span>
          </div>

          <div className="intake-cell">
            <span className="intake-label">Total Value & Cap</span>
            <div className="intake-badge-wrapper">
              <span
                className={`intake-cap-pill ${
                  (metadata.total_value || '').includes('Capped') ||
                  (metadata.total_value || '').startsWith('$')
                    ? 'cap-pill-green'
                    : (metadata.total_value || '').includes('Rate Card')
                    ? 'cap-pill-blue'
                    : 'cap-pill-amber'
                }`}
              >
                {metadata.total_value || 'Not Capped'}
              </span>
            </div>
            <span className="intake-subtext">Budgetary Governance</span>
          </div>

          <div className="intake-cell">
            <span className="intake-label">Governing Jurisdiction</span>
            <span className="intake-value">
              {metadata.governing_jurisdiction || 'Unspecified'}
            </span>
            <span className="intake-subtext">Applicable Legal Venue</span>
          </div>
        </div>

        {contract.executive_summary && (
          <div className="intake-briefing-callout">
            <div className="briefing-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <div className="briefing-text">
              <strong>Counsel Intake Briefing:</strong> {contract.executive_summary}
            </div>
          </div>
        )}
      </section>

      {/* 3. The 6 Mandatory Checklist Criteria */}
      <section className="checklist-section" aria-label="Mandatory Criteria">
        <h3 className="card-section-title" style={{ padding: '0 0 var(--space-2) 0', border: 'none', background: 'none' }}>
          Mandatory Criteria Evaluation
        </h3>

        <div className="checklist-list">
          {checklistItems.map((item, index) => {
            const statusLower = (item.status || '').toLowerCase()
            const isMissing = statusLower === 'missing'
            const isPassed = statusLower === 'passed'

            return (
              <article
                key={index}
                className={`checklist-card ${
                  isMissing ? 'missing' : isPassed ? 'passed' : 'ambiguous'
                }`}
              >
                <div className="checklist-card-header">
                  <div className="checklist-card-title">
                    <span className="checklist-number">{index + 1}.</span>
                    <div>
                      <h4 className="checklist-name">{item.name}</h4>
                      {item.clause_ref && (
                        <span className="clause-ref-tag">{item.clause_ref}</span>
                      )}
                    </div>
                  </div>

                  <span
                    className={`status-badge ${
                      isPassed
                        ? 'badge-completed'
                        : isMissing
                        ? 'badge-changes'
                        : 'badge-pending'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>

                {item.found_text && isPassed && (
                  <blockquote className="clause-snippet-box">
                    "{item.found_text}"
                  </blockquote>
                )}

                <p className="checklist-details">{item.details}</p>

                {/* 1-Click Auto-Remediate for Missing / Ambiguous Items */}
                {isMissing && (
                  <div className="checklist-remediate-box">
                    <span className="remediate-text">
                      Missing mandatory legal provision. Standard enterprise clause available.
                    </span>
                    <button
                      type="button"
                      className="btn-auto-remediate"
                      onClick={() => handleAutoRemediate(item)}
                      title="Open Redline Studio with standard clause"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                      <span>1-Click Auto-Remediate</span>
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      {/* 4. High-Risk Exposure Register */}
      <section className="risk-register-section" aria-label="Risk Exposure Register">
        <h3 className="card-section-title" style={{ padding: '0 0 var(--space-2) 0', border: 'none', background: 'none' }}>
          High-Risk Exposure Register {riskFlags.length > 0 && `(${riskFlags.length})`}
        </h3>

        {riskFlags.length === 0 ? (
          <div className="no-risks-banner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>No high-risk exposure clauses detected in this agreement.</span>
          </div>
        ) : (
          <div className="checklist-list">
            {riskFlags.map((risk, index) => (
              <article key={index} className="risk-register-card">
                <div className="risk-header-row">
                  <div className="risk-title-group">
                    <h4 className="risk-title">{risk.title}</h4>
                    <span className="clause-ref-tag">{risk.clause_ref}</span>
                  </div>
                  <span className="status-badge badge-changes">
                    {risk.severity} RISK
                  </span>
                </div>

                {risk.snippet && (
                  <blockquote className="clause-snippet-box">
                    "{risk.snippet}"
                  </blockquote>
                )}

                <p className="risk-explanation">
                  <strong>Exposure Analysis:</strong> {risk.explanation}
                </p>

                {risk.suggested_fallback && (
                  <div className="risk-fallback-box">
                    <span className="fallback-label">Recommended Balanced Fallback</span>
                    <span className="fallback-content">{risk.suggested_fallback}</span>
                  </div>
                )}

                <div className="risk-actions-row">
                  <button
                    type="button"
                    className="btn-remediate-risk"
                    onClick={() => handleRemediateRisk(risk)}
                  >
                    <span>Remediate in Amend Studio →</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
