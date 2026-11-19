import React, { useState, useEffect, useRef } from 'react'
import './ChatView.css'

const PRESET_INQUIRIES = [
  { label: 'Resource Hourly Rates', query: 'What are the resource hourly rates defined in this contract?', isSimulation: false },
  { label: 'Termination Notice', query: 'What is the notice deadline for termination or non-renewal?', isSimulation: false },
  { label: 'Liability Limits & Caps', query: 'What are the liability caps, damages limitations, and indemnity terms?', isSimulation: false },
  { label: 'Not-to-Exceed Budget Cap', query: 'Does this contract include an explicit budget ceiling or Not-to-Exceed cap?', isSimulation: false },
  { label: '⚡ What if: Net 60 Terms', query: 'What if I change payment terms from Net 30 to Net 60? Will it cause any conflicts?', isSimulation: true },
  { label: '⚡ What if: Increase Dev Rate', query: 'What if we increase the developer rate to $120/hr? Does it conflict with the budget cap?', isSimulation: true },
]

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

      // Auto-expand citations for standard questions if fewer than 3
      if (data.citations && data.citations.length > 0 && !data.conflict_report) {
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
    const recs = (conflictReport.recommendations || []).join(' ')
    const prefillText = `Harmonize contract for contemplated change: "${userQuery}". ${recs}`
    onNavigateToAmend(prefillText)
  }

  return (
    <div className="chat-container">
      {/* 1. Chat Header */}
      <div className="chat-header">
        <div className="chat-header-info">
          <h2 className="chat-header-title">Document Intelligence & Conflict Simulator</h2>
          <p className="chat-header-subtitle">
            Semantic vector Q&A grounded in contract text with What-If contradiction simulation
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
              {preset.isSimulation && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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
            <div className="empty-state-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <line x1="9" y1="10" x2="15" y2="10" />
                <line x1="12" y1="7" x2="12" y2="13" />
              </svg>
            </div>
            <h3 className="empty-state-title">Ask Questions or Simulate Term Changes</h3>
            <p className="empty-state-desc">
              Inquire about rates, deadlines, or liabilities with grounded citations, or test a "What-If" change to detect cross-clause contradictions before modifying the contract.
            </p>
            <div className="empty-state-hints">
              <span className="hint-pill">💡 "What are the rates?"</span>
              <span className="hint-pill">⚡ "What if I change payment to Net 60?"</span>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message-row ${msg.sender === 'user' ? 'row-user' : 'row-agent'}`}>
              <div className="message-bubble">
                <div className="message-meta">
                  <span className="sender-name">
                    {msg.sender === 'user' ? 'Legal Counsel' : 'Contract Agent'}
                  </span>
                  {msg.isSimulation && (
                    <span className="simulation-tag">What-If Simulation</span>
                  )}
                  <span className="message-time">{msg.timestamp}</span>
                </div>

                {/* Conflict Alert Card if conflict detected */}
                {msg.conflictReport && msg.conflictReport.status === 'CONFLICT_DETECTED' ? (
                  <div className="conflict-alert-card">
                    <div className="conflict-card-header">
                      <div className="conflict-badge-severity">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <span>{msg.conflictReport.severity} SEVERITY CONFLICT</span>
                      </div>
                      <span className="conflict-count-text">
                        {msg.conflictReport.conflict_count} Contradiction{msg.conflictReport.conflict_count > 1 ? 's' : ''} Detected
                      </span>
                    </div>

                    <div className="conflict-summary-banner">
                      Contemplated term change creates legal contradictions with existing contract provisions:
                    </div>

                    {/* Conflict Items List */}
                    <div className="conflict-items-list">
                      {(msg.conflictReport.conflicts || []).map((conf, cIdx) => (
                        <div key={cIdx} className="conflict-item">
                          <div className="conflict-item-header">
                            <span className="conflict-sec-badge">{conf.section_ref}</span>
                            <span className="conflict-sec-severity">{conf.severity}</span>
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
                        <div className="rec-title">Recommended Harmonization Actions:</div>
                        <ul className="rec-list">
                          {msg.conflictReport.recommendations.map((rec, rIdx) => (
                            <li key={rIdx}>{rec}</li>
                          ))}
                        </ul>
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
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        <span>Draft Harmonized Amendment</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Standard Grounded Answer */
                  <div className="message-prose">
                    {msg.text.split('\n\n').map((paragraph, pIdx) => {
                      if (paragraph.startsWith('>')) {
                        return (
                          <blockquote key={pIdx} className="prose-quote">
                            {paragraph.replace(/^>\s*/, '').replace(/"/g, '')}
                          </blockquote>
                        )
                      }
                      return <p key={pIdx}>{paragraph}</p>
                    })}
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
            </div>
          ))
        )}

        {loading && (
          <div className="message-row row-agent">
            <div className="message-bubble loading-bubble">
              <div className="pulse-loader">
                <span className="pulse-dot"></span>
                <span className="pulse-dot"></span>
                <span className="pulse-dot"></span>
              </div>
              <span className="loading-text">
                Consulting ChromaDB vector index & simulating cross-clause impact...
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
            placeholder="Ask a question or test a contemplated change (e.g. 'What if we change payment terms to Net 60?')..."
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
