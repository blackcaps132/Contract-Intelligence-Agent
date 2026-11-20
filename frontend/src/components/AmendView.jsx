import React, { useState, useEffect } from 'react'
import './AmendView.css'

const PRESET_CHIPS = [
  { label: 'Establish $195k Budget Cap', text: 'Establish a strict $195,000 Not-to-Exceed budget cap in Section 3' },
  { label: 'Increase Developer Rate to $120/hr', text: 'Increase developer hourly billing rate to $120/hr' },
  { label: 'Extend Payment Terms to Net 60', text: 'Extend monthly invoice payment terms to Net 60 days' },
  { label: 'Shorten Termination Notice to 15 Days', text: 'Shorten convenience termination notice window to 15 days' },
  { label: 'Set Governing Law to Delaware', text: 'Update governing jurisdiction to the State of Delaware' },
]

function truncateAtWordBoundary(str, maxLen = 68) {
  if (!str) return ''
  const trimmed = str.trim()
  if (trimmed.length <= maxLen) return trimmed

  const words = trimmed.split(/\s+/)
  let result = ''
  for (const w of words) {
    if ((result ? result + ' ' + w : w).length <= maxLen) {
      result = result ? result + ' ' + w : w
    } else {
      break
    }
  }
  result = result.replace(/\s+(?:and|or|to|for|in|on|at|with|by|from|the|a|an)$/i, '')
  return result.replace(/[.;:,]+$/, '')
}

function cleanClauseRationale(rawText, secNum = '') {
  let text = (rawText || '').trim()
  if (!text) return ''

  // 1. Remove markdown formatting, quotes, bullets
  text = text.replace(/[*_#`"]/g, '')
  text = text.replace(/^[•*\-\s]+/, '')

  // 2. Remove parentheticals (e.g. "(renamed to Termination and Jurisdiction or adjusted)")
  text = text.replace(/\s*\([^)]*\)/g, '')

  // 3. Strip leading actions/verbs and repeated section references
  for (let i = 0; i < 3; i++) {
    text = text.replace(/^(?:Updated|Amended|Inserted|Added|Changed|Modified|Clause|Section\s*\d+(?:\.\d+)*|Mandatory)\s*[:.\-]?\s*/i, '')
    if (secNum) {
      const escapedSec = secNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      text = text.replace(new RegExp('^' + escapedSec + '\\s*[:.\\-]?\\s*', 'i'), '')
    }
    text = text.replace(/^(?:to comply with the instruction to|to satisfy checklist requirements?|to satisfy|to specify|to establish|to require|to extend|to add|to update|to set)\s+/i, '')
    text = text.trim()
  }

  if (text) {
    text = text.charAt(0).toUpperCase() + text.slice(1)
    text = text.replace(/[.;:,]+$/, '')
  }

  return text
}

export function generateCleanCommitMessage(proposal) {
  if (!proposal) return ''

  // 1. If backend or LLM already provided a clean suggested_commit_message, use it
  if (proposal.suggested_commit_message && proposal.suggested_commit_message.trim()) {
    const raw = proposal.suggested_commit_message.trim().replace(/\.+$/, '')
    if (raw && !raw.endsWith('...')) {
      return raw
    }
  }

  // 2. Synthesize from diffs
  const diffs = proposal.diffs || []
  if (diffs.length === 1) {
    const diff = diffs[0]
    const secNum = (diff.section_number || '').trim()
    const cleaned = cleanClauseRationale(diff.rationale || diff.section_title || proposal.instruction, secNum)

    if (cleaned) {
      let actionText = cleaned
      if (/^\d+\s+days/i.test(cleaned)) {
        actionText = `Set notice period to ${cleaned}`
      } else if (/^(?:Not-to-Exceed|\$\d+|Budget)/i.test(cleaned)) {
        actionText = `Add ${cleaned}`
      }

      const fullMsg = secNum ? `${secNum}: ${actionText}` : actionText
      return truncateAtWordBoundary(fullMsg, 68)
    }
  }

  if (diffs.length > 1) {
    const secNums = diffs
      .map(d => (d.section_number || '').replace(/Section\s*/i, '').trim())
      .filter(Boolean)
    const secLabel = secNums.length > 0 ? `Sections ${secNums.slice(0, 3).join(', ')}` : `${diffs.length} clauses`
    return `${secLabel}: Update contract provisions`
  }

  // 3. Fallback from proposal summary or instruction without ellipses
  const fallback = proposal.summary_of_changes || proposal.instruction || `Amend provisions to ${proposal.proposed_version || 'next version'}`
  let line = fallback.split('\n')[0].replace(/^[•*\-\s]+/, '').replace(/[*_#`"]/g, '')
  line = line.replace(/\s*\([^)]*\)/g, '').trim().replace(/[.;:,]+$/, '')
  return truncateAtWordBoundary(line, 68)
}

export default function AmendView({
  contract,
  initialInstruction = '',
  onClearRemediationDraft,
  onContractUpdate,
  onNavigateToTab,
}) {
  const [instruction, setInstruction] = useState(initialInstruction || '')
  const [authorName, setAuthorName] = useState('Legal Counsel')
  const [commitMessage, setCommitMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState(null)
  const [error, setError] = useState(null)
  const [diffMode, setDiffMode] = useState('split') // default: 'split' (Side-by-Side Split)

  // Sync instruction when initialInstruction changes (e.g. from Auto-Remediate or Conflict Simulator)
  useEffect(() => {
    if (initialInstruction && initialInstruction.trim() !== '') {
      let resolved = initialInstruction
      if (resolved.includes('[X]') || resolved.includes('[x]')) {
        // Resolve [X] against contract content
        const lines = (contract?.content || '').split('\n')
        const secRegex = /^(?:#+\s*)?(?:SECTION|ARTICLE)\s*(\d+)[:.\-\s]+([^\n\r]+)/i
        const secNums = []
        lines.forEach((l) => {
          const m = l.trim().match(secRegex)
          if (m) secNums.push(parseInt(m[1], 10))
        })
        const maxNum = secNums.length > 0 ? Math.max(...secNums) : 0
        const nextNum = maxNum > 0 ? maxNum + 1 : 1
        resolved = resolved.replace(/\[X\]/gi, String(nextNum))
      }
      resolved = resolved.replace(/\[Amount\]/gi, '195,000')
      setInstruction(resolved)
      setProposal(null)
      setCommitResult(null)
      setError(null)
    }
  }, [initialInstruction, contract?.content])

  // Automatically suggest a clean commit message when a proposal is generated
  useEffect(() => {
    if (proposal) {
      const cleanMsg = generateCleanCommitMessage(proposal)
      setCommitMessage(cleanMsg)
    }
  }, [proposal])

  const handleChipClick = (chip) => {
    setInstruction((prev) => {
      if (!prev.trim()) return chip.text
      // Append if already has text
      return `${prev.trim()}; ${chip.text}`
    })
  }

  const handleClearInstruction = () => {
    setInstruction('')
    if (onClearRemediationDraft) onClearRemediationDraft()
  }

  const handleProposeAmendment = async (e) => {
    if (e) e.preventDefault()
    if (!instruction.trim() || generating || !contract?.id) return

    try {
      setGenerating(true)
      setError(null)
      setProposal(null)
      setCommitResult(null)

      const res = await fetch(`/api/contracts/${contract.id}/propose-amendment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: instruction.trim(),
          author_name: authorName.trim() || 'Legal Counsel',
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      setProposal(data)
    } catch (err) {
      console.error('[AmendView] Proposal generation failed:', err)
      setError(err.message || 'Failed to generate amendment proposal.')
    } finally {
      setGenerating(false)
    }
  }

  const handleDiscardProposal = () => {
    setProposal(null)
    setCommitResult(null)
    setError(null)
  }

  const handleCommitProposal = async () => {
    if (!proposal || committing || !contract?.id) return

    try {
      setCommitting(true)
      setError(null)

      const payload = {
        proposal_id: proposal.proposal_id,
        author_name: authorName.trim() || 'Legal Counsel',
        commit_message: commitMessage.trim() || `Commit amendment ${proposal.proposed_version}`,
        updated_content: proposal.proposed_content,
        diffs: proposal.diffs,
        changelog_summary: proposal.summary_of_changes,
      }

      const res = await fetch(`/api/contracts/${contract.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      setCommitResult(data)
      setProposal(null)

      // Fetch fresh contract state so parent tabs and header reflect new version immediately
      try {
        const refreshRes = await fetch(`/api/contracts/${contract.id}`)
        if (refreshRes.ok) {
          const freshContract = await refreshRes.json()
          if (onContractUpdate) onContractUpdate(freshContract)
        }
      } catch (refreshErr) {
        console.warn('[AmendView] Failed to refresh contract after commit:', refreshErr)
      }
    } catch (err) {
      console.error('[AmendView] Commit failed:', err)
      setError(err.message || 'Failed to commit amendment.')
    } finally {
      setCommitting(false)
    }
  }

  const handleResetForNewDraft = () => {
    setProposal(null)
    setCommitResult(null)
    setInstruction('')
    setError(null)
    if (onClearRemediationDraft) onClearRemediationDraft()
  }

  return (
    <div className="amend-view">
      {/* 1. Post-Commit Success Screen */}
      {commitResult && (
        <div className="amend-commit-success">
          <div className="success-banner-header">
            <div className="success-icon-badge" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="success-banner-text">
              <h2 className="success-banner-title">
                Version {commitResult.version_tag} Successfully Committed
              </h2>
              <p className="success-banner-desc">
                Git-style commit snapshot recorded with full clause-level audit trail. The contract repository and vector index have been updated.
              </p>
            </div>
          </div>

          <div className="commit-summary-grid">
            <div className="commit-metric-tile">
              <span className="commit-metric-label">Version</span>
              <span className="commit-metric-value mono-val">{commitResult.version_tag}</span>
            </div>
            <div className="commit-metric-tile">
              <span className="commit-metric-label">Commit ID</span>
              <span className="commit-metric-value mono-val">{commitResult.version_id}</span>
            </div>
            <div className="commit-metric-tile">
              <span className="commit-metric-label">Author</span>
              <span className="commit-metric-value">{commitResult.author_name}</span>
            </div>
            <div className="commit-metric-tile">
              <span className="commit-metric-label">Clauses Modified</span>
              <span className="commit-metric-value">{commitResult.diffs_count} clause(s)</span>
            </div>
          </div>

          <div className="commit-message-preview">
            <span className="commit-msg-label">Commit Log:</span>
            <span className="commit-msg-text">"{commitResult.commit_message}"</span>
          </div>

          <div className="success-action-row">
            <button
              className="btn btn-primary btn-action-lg"
              onClick={() => onNavigateToTab && onNavigateToTab('read')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              View in Document Reader
            </button>
            <button
              className="btn btn-secondary btn-action-lg"
              onClick={() => onNavigateToTab && onNavigateToTab('history')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              View in Version History
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleResetForNewDraft}
            >
              Draft Another Amendment
            </button>
          </div>
        </div>
      )}

      {/* 2. Natural Language Amendment Drafting Card (when not committed) */}
      {!commitResult && !proposal && (
        <div className="amend-draft-card">
          <div className="draft-card-header">
            <div className="draft-header-titles">
              <h2 className="draft-card-title">Redline Studio & Clause Drafting</h2>
              <p className="draft-card-subtitle">
                Describe desired contract amendments in plain English. The agent locates affected clauses, proposes standardized language, computes word-level redline diffs, and holds for mandatory counsel approval.
              </p>
            </div>
            <div className="current-ver-pill">
              Active: <span className="mono-ver">{contract?.current_version || 'v1.0'}</span>
            </div>
          </div>

          {/* Queued from Audit or Conflict Simulator notification */}
          {initialInstruction && (
            <div className="queued-draft-banner">
              <div className="queued-draft-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>Draft instruction pre-filled from Checklist / Conflict Simulator.</span>
              </div>
              <button
                className="btn-clear-queued"
                onClick={handleClearInstruction}
                title="Clear pre-filled draft"
              >
                Clear
              </button>
            </div>
          )}

          {/* Quick Preset Prompt Chips (Neutral row) */}
          <div className="preset-chips-section">
            <span className="preset-chips-label">SUGGESTED AMENDMENTS:</span>
            <div className="preset-chips-row">
              {PRESET_CHIPS.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="preset-chip"
                  onClick={() => handleChipClick(chip)}
                  title={chip.text}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Instruction Input Form */}
          <form className="draft-form" onSubmit={handleProposeAmendment}>
            <div className="draft-field">
              <label htmlFor="amend-instruction" className="draft-field-label">
                Amendment Instruction (Plain English)
              </label>
              <textarea
                id="amend-instruction"
                className="draft-textarea"
                rows={4}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g., Establish a strict $195,000 Not-to-Exceed budget cap in Section 3, increase Senior Strategist rate to $140/hr, and extend payment terms to Net 60 days..."
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault()
                    handleProposeAmendment()
                  }
                }}
              />
              <span className="draft-hint">
                Tip: Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to generate redline proposal.
              </span>
            </div>

            <div className="draft-bottom-bar">
              <div className="author-field">
                <label htmlFor="amend-author" className="author-label">Author:</label>
                <input
                  id="amend-author"
                  type="text"
                  className="author-input"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Legal Counsel"
                />
              </div>

              <div className="draft-actions">
                {instruction && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setInstruction('')}
                    disabled={generating}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="submit"
                  className="btn btn-primary btn-generate"
                  disabled={!instruction.trim() || generating}
                >
                  {generating ? (
                    <>
                      <span className="btn-spinner" aria-hidden="true" />
                      Analyzing Clauses & Drafting...
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      Generate Redline Proposal
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          {error && (
            <div className="amend-error-alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {/* 3. Proposal Review & Approval Gate (Visible when proposal is generated) */}
      {!commitResult && proposal && (
        <div className="amend-proposal-container">
          {/* Proposal Header Banner */}
          <div className="proposal-top-card">
            <div className="proposal-top-main">
              <div className="version-bump-badge">
                <span className="ver-prev">{contract?.current_version || 'v1.0'}</span>
                <span className="ver-arrow" aria-hidden="true">→</span>
                <span className="ver-next">{proposal.proposed_version}</span>
              </div>
              <div className="proposal-title-meta">
                <h2 className="proposal-main-title">Amendment Proposal Review</h2>
                <div className="proposal-sub-meta">
                  <span className="proposal-id-tag">ID: {proposal.proposal_id}</span>
                  <span className="pending-badge">PENDING COUNSEL APPROVAL</span>
                  <span className="diff-count-tag">{proposal.diffs.length} clause(s) modified</span>
                </div>
              </div>
            </div>

            <div className="proposal-top-actions">
              <button
                className="btn btn-secondary btn-discard-top"
                onClick={handleDiscardProposal}
                disabled={committing}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Discard Proposal
              </button>
            </div>
          </div>

          {/* Executive Summary of Changes */}
          <div className="summary-changes-card">
            <div className="card-section-label">EXECUTIVE SUMMARY OF CHANGES:</div>
            <div className="summary-changes-content">
              {proposal.summary_of_changes}
            </div>
          </div>

          {/* Cross-Clause Impact & Contradiction Warnings Banner */}
          {proposal.warnings && proposal.warnings.length > 0 && (
            <div className="impact-warnings-card">
              <div className="warning-card-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span className="warning-card-title">Cross-Clause Impact & Contradiction Warnings</span>
              </div>
              <ul className="warning-list">
                {proposal.warnings.map((warn, wIdx) => (
                  <li key={wIdx} className="warning-item">
                    {warn}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sentence / Line-Level Redline Diff Viewer */}
          <div className="redline-diff-section">
            <div className="diff-section-header">
              <div className="diff-header-title">
                <span className="diff-title-text">Clause-Level Redline Diffs</span>
                <span className="diff-legend-hints">
                  {diffMode === 'split' ? (
                    <>
                      <span className="legend-del"><span className="split-indicator">−</span> Red = Removed in Current</span>
                      <span className="legend-ins"><span className="split-indicator">+</span> Green = Added in Proposed</span>
                    </>
                  ) : (
                    <>
                      <span className="legend-del"><del>Strikethrough</del> = Removed</span>
                      <span className="legend-ins"><ins>Underlined / Bold</ins> = Added</span>
                    </>
                  )}
                </span>
              </div>

              {/* Diff Mode Toggle: Side-by-Side (Default) vs Inline */}
              <div className="diff-mode-toggle" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={diffMode === 'split'}
                  className={`diff-toggle-btn ${diffMode === 'split' ? 'active' : ''}`}
                  onClick={() => setDiffMode('split')}
                >
                  Side-by-Side Split
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={diffMode === 'inline'}
                  className={`diff-toggle-btn ${diffMode === 'inline' ? 'active' : ''}`}
                  onClick={() => setDiffMode('inline')}
                >
                  Inline Redline
                </button>
              </div>
            </div>

            {/* Diff Cards for each clause */}
            <div className="diff-cards-stack">
              {proposal.diffs.map((diff, dIdx) => (
                <div key={dIdx} className="clause-diff-card">
                  <div className="clause-diff-header">
                    <div className="clause-header-left">
                      <span className="clause-badge">{diff.section_number}</span>
                      <span className="clause-title">{diff.section_title}</span>
                    </div>
                    {diff.rationale && (
                      <span className="clause-rationale" title={diff.rationale}>
                        Rationale: {diff.rationale}
                      </span>
                    )}
                  </div>

                  {/* Mode 1: Side-by-Side Split (Default) */}
                  {diffMode === 'split' && (
                    <div className="split-diff-grid">
                      <div className="split-diff-col before-col">
                        <div className="split-col-header">
                          <span className="split-col-label">CURRENT ({contract?.current_version || 'v1.0'})</span>
                        </div>
                        <div
                          className="split-col-body paper-prose"
                          dangerouslySetInnerHTML={{
                            __html: diff.before_html || diff.before_text || '<span class="diff-empty-notice">[Clause Did Not Exist]</span>',
                          }}
                        />
                      </div>
                      <div className="split-diff-col after-col">
                        <div className="split-col-header">
                          <span className="split-col-label">PROPOSED ({proposal.proposed_version})</span>
                        </div>
                        <div
                          className="split-col-body paper-prose"
                          dangerouslySetInnerHTML={{
                            __html: diff.after_html || diff.after_text,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Mode 2: Inline Redline */}
                  {diffMode === 'inline' && (
                    <div className="inline-diff-content">
                      <div
                        className="diff-html-body paper-prose"
                        dangerouslySetInnerHTML={{ __html: diff.diff_html || diff.after_text }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Mandatory Counsel Approval Gate Card */}
          <div className="approval-gate-card">
            <div className="gate-header">
              <div className="gate-icon-badge" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className="gate-header-text">
                <h3 className="gate-title">Counsel Approval Gate</h3>
                <p className="gate-subtitle">
                  Mandatory human-in-the-loop authorization. Modifications will not be saved to SQLite, committed to version history, or reindexed in vector search until counsel explicitly approves.
                </p>
              </div>
            </div>

            <div className="gate-form-row">
              <div className="gate-field author-gate-field">
                <label htmlFor="commit-author" className="gate-label">Author Name</label>
                <input
                  id="commit-author"
                  type="text"
                  className="gate-input"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Legal Counsel"
                  disabled={committing}
                />
              </div>

              <div className="gate-field commit-msg-gate-field">
                <label htmlFor="commit-msg" className="gate-label">Commit Message</label>
                <input
                  id="commit-msg"
                  type="text"
                  className="gate-input"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder={`Amend contract to ${proposal.proposed_version}`}
                  disabled={committing}
                />
              </div>
            </div>

            {error && (
              <div className="amend-error-alert gate-error">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <div className="gate-action-bar">
              <button
                type="button"
                className="btn btn-secondary btn-discard"
                onClick={handleDiscardProposal}
                disabled={committing}
              >
                Discard Proposal
              </button>

              <button
                type="button"
                className="btn btn-primary btn-approve-commit"
                onClick={handleCommitProposal}
                disabled={committing}
              >
                {committing ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" />
                    Committing {proposal.proposed_version} & Reindexing...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Approve & Commit {proposal.proposed_version}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
