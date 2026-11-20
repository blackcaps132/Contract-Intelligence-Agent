import React, { useState, useEffect, useRef } from 'react'
import './ChatView.css'

const PRESET_INQUIRIES = [
  { label: 'Resource Hourly Rates', query: 'What are the resource hourly rates defined in this contract?', isSimulation: false },
  { label: 'Termination Notice', query: 'What is the notice deadline for termination or non-renewal?', isSimulation: false },
  { label: 'Liability Limits & Caps', query: 'What are the liability caps, damages limitations, and indemnity terms?', isSimulation: false },
  { label: 'Not-to-Exceed Budget Cap', query: 'Does this contract include an explicit budget ceiling or Not-to-Exceed cap?', isSimulation: false },
  { label: 'Net 60 Terms', query: 'What if I change payment terms from Net 30 to Net 60? Will it cause any conflicts?', isSimulation: true },
  { label: 'Increase Dev Rate', query: 'What if we increase the developer rate to $120/hr? Does it conflict with the budget cap?', isSimulation: true },
]

/**
 * Rich Legal Markdown & Prose Formatter
 */
function FormattedProse({ text }) {
  if (!text) return null

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

  const parseInlineFormatting = (str) => {
    if (!str) return null
    const tokens = str.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\$\d+(?:,\d{3})*(?:\.\d{2})?(?:\s*(?:\/hr|per\s+hour))?|\((?:Section|Article)\s+[\d\.]+\))/g)

    return tokens.map((part, i) => {
      if (!part) return null

      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={i} className="prose-strong">
            {part.slice(2, -2)}
          </strong>
        )
      }

      if (part.startsWith('*') && part.endsWith('*') && part.length > 2 && !part.startsWith('**')) {
        return (
          <em key={i} className="prose-em">
            {part.slice(1, -1)}
          </em>
        )
      }

      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code key={i} className="prose-code">
            {part.slice(1, -1)}
          </code>
        )
      }

      if (/^\((?:Section|Article)\s+[\d\.]+\)$/i.test(part)) {
        return (
          <span key={i} className="inline-sec-badge" title="Grounded Clause Citation">
            {part.replace(/[()]/g, '')}
          </span>
        )
      }

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

    if (/^[•\-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const cleanItem = trimmed.replace(/^[•\-*]\s+/, '').replace(/^\d+\.\s+/, '')
      currentList.push(cleanItem)
      return
    }

    flushList(index)

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

    if (trimmed.startsWith('⚠️') || trimmed.startsWith('🚨')) {
      elements.push(
        <div key={`alert-${index}`} className="chat-prose-alert">
          <span className="alert-symbol">⚠️</span>
          <div className="alert-body">{parseInlineFormatting(trimmed.replace(/^[⚠️🚨]\s*/, ''))}</div>
        </div>
      )
      return
    }

    if (trimmed.startsWith('✅')) {
      elements.push(
        <div key={`success-${index}`} className="chat-prose-success">
          <span className="success-symbol">✓</span>
          <div className="success-body">{parseInlineFormatting(trimmed.replace(/^✅\s*/, ''))}</div>
        </div>
      )
      return
    }

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
  // Sessions & Conversation Threads State
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState('New Conversation')
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Messages & Query State
  const [messages, setMessages] = useState([])
  const [inputQuery, setInputQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedCitations, setExpandedCitations] = useState({})

  const messagesContainerRef = useRef(null)
  const inputRef = useRef(null)

  const scrollToBottom = (smooth = true) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      })
    }
  }

  useEffect(() => {
    if (messages.length > 0 || loading) {
      scrollToBottom()
    }
  }, [messages, loading])

  // Load chat sessions on mount or when contract changes
  useEffect(() => {
    if (!contract?.id) return
    loadSessions()
    // Open on fresh new chat whenever opening the contract chat tab
    handleNewChat()
  }, [contract?.id])

  const loadSessions = async () => {
    try {
      setLoadingSessions(true)
      const res = await fetch(`/api/contracts/${contract.id}/chat/sessions`)
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
      }
    } catch (err) {
      console.error('[ChatView] Failed to fetch sessions:', err)
    } finally {
      setLoadingSessions(false)
    }
  }

  const handleSelectSession = async (session) => {
    if (activeSessionId === session.session_id) return
    setActiveSessionId(session.session_id)
    setActiveSessionTitle(session.title)
    setLoading(true)

    try {
      const res = await fetch(`/api/contracts/${contract.id}/chat/sessions/${session.session_id}`)
      if (res.ok) {
        const data = await res.json()
        const formatted = (data.messages || []).map((m) => ({
          id: m.id,
          sender: m.sender,
          text: m.text,
          queryType: m.query_type,
          isSimulation: m.is_simulation,
          citations: m.citations || [],
          conflictReport: m.conflict_report,
          timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }))
        setMessages(formatted)
      }
    } catch (err) {
      console.error('[ChatView] Failed to load session messages:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleNewChat = () => {
    setActiveSessionId(null)
    setActiveSessionTitle('New Conversation')
    setMessages([])
    setInputQuery('')
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80)
  }

  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/contracts/${contract.id}/chat/sessions/${sessionId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.session_id !== sessionId))
        if (activeSessionId === sessionId) {
          handleNewChat()
        }
      }
    } catch (err) {
      console.error('[ChatView] Failed to delete session:', err)
    }
  }

  const toggleCitations = (msgId) => {
    setExpandedCitations((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }))
  }

  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || inputQuery).trim()
    if (!query || !contract?.id || loading) return

    const isChange = /change|modify|what if|conflict|raise|increase|switch to|update|amend/i.test(query)
    const userMsgId = `usr_${Date.now()}`

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

    // Determine target session ID (existing or create new)
    const targetSessionId = activeSessionId || `sess_${Date.now()}`

    try {
      const res = await fetch(`/api/contracts/${contract.id}/chat/sessions/${targetSessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      const agentMsgId = data.agent_message.id || `agent_${Date.now()}`

      const agentMessage = {
        id: agentMsgId,
        sender: 'agent',
        text: data.agent_message.text,
        queryType: data.agent_message.query_type,
        citations: data.agent_message.citations || [],
        conflictReport: data.agent_message.conflict_report,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }

      setMessages((prev) => [...prev, agentMessage])

      // If this was a new chat, update session state and sidebar list
      if (!activeSessionId) {
        setActiveSessionId(targetSessionId)
        setActiveSessionTitle(data.session_title || 'Contract Discussion')
        setSessions((prev) => [
          {
            session_id: targetSessionId,
            contract_id: contract.id,
            title: data.session_title || 'Contract Discussion',
            updated_at: new Date().toISOString(),
            message_count: 2,
          },
          ...prev,
        ])
      } else {
        // Bump active session to top
        setSessions((prev) => {
          const filtered = prev.filter((s) => s.session_id !== targetSessionId)
          const current = prev.find((s) => s.session_id === targetSessionId)
          if (current) {
            return [{ ...current, title: data.session_title || current.title, updated_at: new Date().toISOString() }, ...filtered]
          }
          return prev
        })
      }

      // Auto-expand citations for standard Q&A when available
      if (data.agent_message.citations?.length > 0 && (!data.agent_message.conflict_report || data.agent_message.conflict_report.status !== 'CONFLICT_DETECTED')) {
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
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100)
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
    <div className="chat-layout-wrapper">
      {/* =========================================================================
          LEFT SIDEBAR: Persistent Conversations History (ChatGPT / Gemini style)
          ========================================================================= */}
      <aside className={`chat-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} aria-label="Conversation History">
        <div className="sidebar-header">
          <button
            type="button"
            className="btn-new-chat"
            onClick={handleNewChat}
            title="Start a fresh chat conversation"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Chat</span>
          </button>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-section-label">
            <span>Conversations</span>
            <span className="sessions-count-pill">{sessions.length}</span>
          </div>

          {loadingSessions ? (
            <div className="sidebar-loading">
              <span className="sidebar-spinner" />
              <span>Loading chats...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="sidebar-empty">
              <p>No previous conversations yet.</p>
              <span className="empty-subtext">Past chats for this contract will appear here.</span>
            </div>
          ) : (
            <div className="sidebar-sessions-list" role="list">
              {sessions.map((sess) => {
                const isActive = activeSessionId === sess.session_id
                return (
                  <div
                    key={sess.session_id}
                    className={`sidebar-session-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleSelectSession(sess)}
                    role="button"
                    tabIndex={0}
                    title={sess.title}
                  >
                    <div className="session-item-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <div className="session-item-info">
                      <span className="session-item-title">{sess.title}</span>
                      <span className="session-item-time">
                        {sess.updated_at ? new Date(sess.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="session-delete-btn"
                      onClick={(e) => handleDeleteSession(e, sess.session_id)}
                      title="Delete conversation"
                      aria-label="Delete conversation"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      {/* =========================================================================
          MAIN CHAT AREA: Q&A, What-If Simulation, and Active Message Stream
          ========================================================================= */}
      <main className="chat-main-area">
        {/* 1. Sleek, minimal chat header */}
        <div className="chat-header">
          <button
            type="button"
            className="btn-toggle-sidebar"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            title={sidebarCollapsed ? 'Show conversation history' : 'Hide conversation history'}
            aria-label="Toggle sidebar"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          <span className="chat-header-title">
            {activeSessionId ? activeSessionTitle : 'New Chat'}
          </span>
        </div>

        {/* 2. Preset Inquiries Bar (One row, neutral chips) */}
        <div className="chat-presets-bar">
          <span className="presets-label">Quick Inquiries:</span>
          <div className="presets-scroll">
            {PRESET_INQUIRIES.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                className="preset-chip"
                onClick={() => handleSendMessage(preset.query)}
                disabled={loading}
                title={preset.query}
              >
                {preset.isSimulation && (
                  <span className="chip-whatif-badge">What if</span>
                )}
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Messages Stream */}
        <div className="chat-messages-area" ref={messagesContainerRef} role="log" aria-live="polite">
          {messages.length === 0 ? (
            <div className="chat-empty-state">
              <div className="empty-state-avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className="empty-state-title">New Conversation</h3>
              <p className="empty-state-desc">
                Ask specific legal questions about rates, notice windows, or liability, or test a what-if scenario to simulate cross-clause contradictions.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`message-row ${msg.sender === 'user' ? 'row-user' : 'row-agent'}`}>
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

                      {msg.conflictReport.harmonized_draft && (
                        <div className="harmonized-draft-block">
                          <div className="draft-header-label">Suggested Harmonized Amendment Text:</div>
                          <div className="draft-code-block">{msg.conflictReport.harmonized_draft}</div>
                        </div>
                      )}

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
                    <div className="message-prose">
                      <FormattedProse text={msg.text} />
                    </div>
                  )}

                  {/* Grounded Citations Drawer */}
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
      </main>
    </div>
  )
}
