import React, { useState, useEffect, useRef } from 'react'
import './ChatView.css'

const PRESET_INQUIRIES = [
  { label: 'Resource Hourly Rates', query: 'What are the resource hourly rates defined in this contract?', isSimulation: false },
  { label: 'Termination Notice', query: 'What is the notice deadline for termination or non-renewal?', isSimulation: false },
  { label: 'Liability Limits & Caps', query: 'What are the liability caps, damages limitations, and indemnity terms?', isSimulation: false },
  { label: 'Not-to-Exceed Budget Cap', query: 'Does this contract include an explicit budget ceiling or Not-to-Exceed cap?', isSimulation: false },
  { label: 'What if: Net 60 Terms', query: 'What if I change payment terms from Net 30 to Net 60? Will it cause any conflicts?', isSimulation: true },
  { label: 'What if: Increase Dev Rate', query: 'What if we increase the developer rate to $120/hr? Does it conflict with the budget cap?', isSimulation: true },
]

/**
 * Rich Legal Markdown & Prose Formatter
 * Parses headers, bold labels, currency highlights, section citations,
 * bullet lists, blockquotes, and risk callout blocks.
 */
function FormattedProse({ text }) {
  if (!text) return null

  // Split into lines
  const rawLines = text.split('\n')
  const elements = []
  let currentList = []

  const flushList = (key) => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`ul-${key}`} className="chat-bullet-list">
          {currentList.map((item, idx) => (
            <li key={idx} className="chat-bullet-item">
              <span className="bullet-marker">•</span>
              <div className="bullet-content">{parseInlineFormatting(item)}</div>
            </li>
          ))}
        </ul>
      )
      currentList = []
    }
  }

  // Parses inline formatting: **bold**, *italic*, `code`, currency, and citations
  const parseInlineFormatting = (str) => {
    if (!str) return null

    // Regex to split on bold **text**, citations (Section X), and currency values
    const tokens = str.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\$\d+(?:,\d{3})*(?:\.\d{2})?(?:\s*(?:\/hr|per\s+hour))?|\((?:Section|Article)\s+[\d\.]+\))/g)

    return tokens.map((part, i) => {
      if (!part) return null

      // Bold: **text**
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={i} className="prose-strong">
            {part.slice(2, -2)}
          </strong>
        )
      }

      // Italic: *text*
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2 && !part.startsWith('**')) {
        return (
          <em key={i} className="prose-em">
            {part.slice(1, -1)}
          </em>
        )
      }

      // Inline code / badge: `code`
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code key={i} className="prose-code">
            {part.slice(1, -1)}
          </code>
        )
      }

      // Section citation badge: (Section 2.1)
      if (/^\((?:Section|Article)\s+[\d\.]+\)$/i.test(part)) {
        return (
          <span key={i} className="inline-sec-badge" title="Grounded Clause Citation">
            {part.replace(/[()]/g, '')}
          </span>
        )
      }

      // Currency / Hourly Rate highlight: $125.00/hr
      if (/^\$\d+(?:,\d{3})*(?:\.\d{2})?(?:\s*(?:\/hr|per\s+hour))?/i.test(part)) {
        return (
          <span key={i} className="inline-currency-badge">
            {part}
          </span>
        )
      }

      return part
    })
  }

  rawLines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList(index)
      return
    }

    // Markdown Heading 3 or 4: ### Heading
    if (trimmed.startsWith('### ') || trimmed.startsWith('#### ')) {
      flushList(index)
      const headingText = trimmed.replace(/^#{3,4}\s+/, '')
      elements.push(
        <h4 key={`h-${index}`} className="chat-prose-heading">
          {parseInlineFormatting(headingText)}
        </h4>
      )
      return
    }

    // Bold title acting as standalone section heading: e.g. **Critical Legal Risks & Compensation Terms:**
    if (/^\*\*[^*]+\*\*:?$/.test(trimmed)) {
      flushList(index)
      const cleanHeader = trimmed.replace(/^\*\*|\*\*:?$/g, '')
      elements.push(
        <div key={`subhead-${index}`} className="chat-section-divider-header">
          <span className="divider-icon">✦</span>
          <span>{cleanHeader}</span>
        </div>
      )
      return
    }

    // Bullet items: •, -, *, or numbered 1.
    if (/^[•\-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const cleanItem = trimmed.replace(/^[•\-*]\s+/, '').replace(/^\d+\.\s+/, '')
      currentList.push(cleanItem)
      return
    }

    flushList(index)

    // Blockquote: > "..."
    if (trimmed.startsWith('>')) {
      const quoteText = trimmed.replace(/^>\s*/, '')
      elements.push(
        <blockquote key={`quote-${index}`} className="chat-prose-quote">
          <div className="quote-bar" />
          <div className="quote-text">{parseInlineFormatting(quoteText)}</div>
        </blockquote>
      )
      return
    }

    // Risk / Warning alert line: e.g. ⚠️ **Critical Risk...**
    if (trimmed.startsWith('⚠️') || trimmed.startsWith('🚨')) {
      elements.push(
        <div key={`alert-${index}`} className="chat-prose-alert">
          <span className="alert-symbol">⚠️</span>
          <div className="alert-body">{parseInlineFormatting(trimmed.replace(/^[⚠️🚨]\s*/, ''))}</div>
        </div>
      )
      return
    }

    // Checkmark / Success line: e.g. ✅ **No Conflict...**
    if (trimmed.startsWith('✅')) {
      elements.push(
        <div key={`success-${index}`} className="chat-prose-success">
          <span className="success-symbol">✓</span>
          <div className="success-body">{parseInlineFormatting(trimmed.replace(/^✅\s*/, ''))}</div>
        </div>
      )
      return
    }

    // Standard paragraph
    elements.push(
      <p key={`p-${index}`} className="chat-prose-p">
        {parseInlineFormatting(trimmed)}
      </p>
    )
  })

  flushList('end')
  return <div className="chat-prose-wrapper">{elements}</div>
}

export default function ChatView({ contract, onNavigateToAmend }) {
  const [messages, setMessages] = useState([])
  const [inputQuery, setInputQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedCitations, setExpandedCitations] = useState({})
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  const toggleCitations = (msgId) => {
    setExpandedCitations((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }))
  }

  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || inputQuery).trim()
    if (!query || !contract?.id || loading) return

    const userMsgId = `usr_${Date.now()}`
    const isChange = /change|modify|what if|conflict|raise|increase|switch to|update|amend/i.test(query)

    const userMessage = {
      id: userMsgId,
      sender: 'user',
      text: query,
      isSimulation: isChange,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputQuery('')
    setLoading(true)

    try {
      const res = await fetch(`/api/contracts/${contract.id}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      const agentMsgId = `agent_${Date.now()}`

      const agentMessage = {
        id: agentMsgId,
        sender: 'agent',
        text: data.answer,
        queryType: data.query_type,
        citations: data.citations || [],
        conflictReport: data.conflict_report,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }

      setMessages((prev) => [...prev, agentMessage])

      // Auto-expand citations for standard Q&A when available
      if (data.citations && data.citations.length > 0 && (!data.conflict_report || data.conflict_report.status !== 'CONFLICT_DETECTED')) {
        setExpandedCitations((prev) => ({ ...prev, [agentMsgId]: true }))
      }
    } catch (err) {
      console.error('[ChatView] Query failed:', err)
      const errorMsg = {
        id: `err_${Date.now()}`,
        sender: 'agent',
        text: `Error processing query: ${err.message}. Please verify the contract is indexed and backend is online.`,
        isError: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleDraftAmendmentFromConflict = (userQuery, conflictReport) => {
    if (!onNavigateToAmend) return
    const draft = conflictReport.harmonized_draft
    const recs = (conflictReport.recommendations || []).join(' ')
    const prefillText = draft
      ? `Apply harmonized amendment: ${draft}`
      : `Harmonize contract for contemplated change: "${userQuery}". ${recs}`
    onNavigateToAmend(prefillText)
  }

  return (
    <div className="chat-container">
      {/* 1. Header with Status Pill */}
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-title-row">
            <h2 className="chat-header-title">Document Intelligence & Conflict Simulator</h2>
            <span className="copilot-ai-badge">
              <span className="badge-pulse-dot" />
              <span>Gemini Intelligence</span>
            </span>
          </div>
          <p className="chat-header-subtitle">
            Deeply grounded legal analysis with cross-clause contradiction simulation across all contract provisions
          </p>
        </div>
      </div>

      {/* 2. Preset Inquiry Chips */}
      <div className="chat-presets-bar">
        <span className="presets-label">Quick Inquiries:</span>
        <div className="presets-scroll">
          {PRESET_INQUIRIES.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              className={`preset-chip ${preset.isSimulation ? 'chip-simulation' : ''}`}
              onClick={() => handleSendMessage(preset.query)}
              disabled={loading}
              title={preset.query}
            >
              {preset.isSimulation ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              )}
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Messages Stream */}
      <div className="chat-messages-area" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            <div className="empty-state-avatar">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h3 className="empty-state-title">Contract Intelligence Ready</h3>
            <p className="empty-state-desc">
              Ask specific legal questions about compensation rates, termination notice periods, or liability carve-outs.
              Or test a <strong>What-If scenario</strong> to simulate cross-clause contradictions before amending terms.
            </p>
            <div className="empty-state-suggestions">
              <button
                type="button"
                className="suggestion-pill"
                onClick={() => handleSendMessage('What are the resource hourly rates defined in this contract?')}
              >
                "What are the resource hourly rates?"
              </button>
              <button
                type="button"
                className="suggestion-pill"
                onClick={() => handleSendMessage('What if I change payment terms from Net 30 to Net 60? Will it cause any conflicts?')}
              >
                "What if: Change to Net 60?"
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message-row ${msg.sender === 'user' ? 'row-user' : 'row-agent'}`}>
              
              {/* Agent Avatar */}
              {msg.sender === 'agent' && (
                <div className="agent-avatar" title="Contract Intelligence Copilot">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </div>
              )}

              <div className="message-bubble">
                <div className="message-meta">
                  <span className="sender-name">
                    {msg.sender === 'user' ? 'Legal Counsel' : 'Contract Intelligence Copilot'}
                  </span>
                  {msg.isSimulation && (
                    <span className="simulation-tag">What-If Simulation</span>
                  )}
                  {msg.sender === 'agent' && (
                    <span className="agent-status-tag">Grounded Analysis</span>
                  )}
                  <span className="message-time">{msg.timestamp}</span>
                </div>

                {/* Conflict Alert Card if conflict detected */}
                {msg.conflictReport && msg.conflictReport.status === 'CONFLICT_DETECTED' ? (
                  <div className="conflict-alert-card">
                    <div className="conflict-card-header">
                      <div className="conflict-badge-severity">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <span>{msg.conflictReport.severity || 'HIGH'} SEVERITY CONFLICT DETECTED</span>
                      </div>
                      <span className="conflict-count-text">
                        {msg.conflictReport.conflict_count} Contradiction{msg.conflictReport.conflict_count > 1 ? 's' : ''} Found
                      </span>
                    </div>

                    {msg.conflictReport.summary && (
                      <div className="conflict-executive-summary">
                        {msg.conflictReport.summary}
                      </div>
                    )}

                    {/* Conflict Items List */}
                    <div className="conflict-items-list">
                      {(msg.conflictReport.conflicts || []).map((conf, cIdx) => (
                        <div key={cIdx} className="conflict-item">
                          <div className="conflict-item-header">
                            <span className="conflict-sec-badge">{conf.section_ref}</span>
                            <span className={`conflict-sec-severity severity-${(conf.severity || 'HIGH').toLowerCase()}`}>
                              {conf.severity || 'HIGH'} RISK
                            </span>
                          </div>
                          <div className="conflict-explanation">{conf.explanation}</div>
                          {conf.conflicting_text && (
                            <blockquote className="conflict-quote">
                              "{conf.conflicting_text}"
                            </blockquote>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Recommendations */}
                    {msg.conflictReport.recommendations && msg.conflictReport.recommendations.length > 0 && (
                      <div className="conflict-recommendations">
                        <div className="rec-title">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="9 11 12 14 22 4" />
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                          </svg>
                          <span>Recommended Harmonization Steps:</span>
                        </div>
                        <ul className="rec-list">
                          {msg.conflictReport.recommendations.map((rec, rIdx) => (
                            <li key={rIdx}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Suggested Harmonized Replacement Draft */}
                    {msg.conflictReport.harmonized_draft && (
                      <div className="harmonized-draft-block">
                        <div className="draft-header-label">Suggested Harmonized Amendment Text:</div>
                        <div className="draft-code-block">{msg.conflictReport.harmonized_draft}</div>
                      </div>
                    )}

                    {/* Action Button: Draft Harmonized Amendment */}
                    <div className="conflict-card-actions">
                      <button
                        type="button"
                        className="btn-draft-harmonized"
                        onClick={() => handleDraftAmendmentFromConflict(msg.text, msg.conflictReport)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                        <span>Draft Harmonized Amendment in Studio</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Formatted Grounded Prose */
                  <div className="message-prose">
                    <FormattedProse text={msg.text} />
                  </div>
                )}

                {/* Grounded Section Citations Drawer */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="citations-container">
                    <button
                      type="button"
                      className="citations-toggle-btn"
                      onClick={() => toggleCitations(msg.id)}
                      aria-expanded={expandedCitations[msg.id]}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                      </svg>
                      <span>
                        {expandedCitations[msg.id]
                          ? `Hide Grounded Citations (${msg.citations.length})`
                          : `View Grounded Citations (${msg.citations.length})`}
                      </span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: expandedCitations[msg.id] ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.15s ease',
                        }}
                        aria-hidden="true"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {expandedCitations[msg.id] && (
                      <div className="citations-list">
                        {msg.citations.map((cit, cIdx) => (
                          <div key={cIdx} className="citation-card">
                            <div className="citation-header">
                              <span className="citation-sec-name">{cit.section}</span>
                              {cit.relevance > 0 && (
                                <span className="citation-relevance">
                                  {Math.round(cit.relevance * 100)}% match
                                </span>
                              )}
                            </div>
                            <blockquote className="citation-snippet">
                              "{cit.snippet}"
                            </blockquote>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* User Avatar */}
              {msg.sender === 'user' && (
                <div className="user-avatar" title="Legal Counsel">
                  <span>LC</span>
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div className="message-row row-agent">
            <div className="agent-avatar avatar-pulse">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div className="message-bubble loading-bubble">
              <div className="pulse-loader">
                <span className="pulse-dot"></span>
                <span className="pulse-dot"></span>
                <span className="pulse-dot"></span>
              </div>
              <span className="loading-text">
                Consulting contract clauses & generating grounded analysis...
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 4. Chat Input Bar */}
      <div className="chat-input-container">
        <form
          className="chat-input-form"
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage()
          }}
        >
          <textarea
            ref={inputRef}
            className="chat-textarea"
            placeholder="Ask a question or test a change (e.g., 'What if we change payment terms to Net 60?')..."
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <button
            type="submit"
            className="chat-send-btn"
            disabled={!inputQuery.trim() || loading}
            title="Send query (Enter)"
            aria-label="Send query"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
        <div className="chat-input-hint">
          <span>Press <strong>Enter</strong> to send, <strong>Shift + Enter</strong> for new line.</span>
          <span>Tip: Prefix with <em>"What if..."</em> to run cross-clause contradiction simulation.</span>
        </div>
      </div>
    </div>
  )
}
