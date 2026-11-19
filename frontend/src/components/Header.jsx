import React from 'react'
import './Header.css'

export default function Header({ currentRoute = 'home', onNavigate, onOpenIngest }) {
  return (
    <header className="top-header">
      <div className="header-inner">
        {/* Left Brand: Subtle scales icon + product name */}
        <div 
          className="brand" 
          onClick={() => onNavigate && onNavigate('home')}
          role="button"
          tabIndex={0}
        >
          <span className="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>
              <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>
              <path d="M7 21h10"/>
              <path d="M12 3v18"/>
              <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>
            </svg>
          </span>
          <span>Contract Intelligence Agent</span>
        </div>

        {/* Navigation: Home and Contracts */}
        <nav className="nav-links" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-link ${currentRoute === 'home' ? 'active' : ''}`}
            onClick={() => onNavigate && onNavigate('home')}
          >
            Home
          </button>
          <button
            type="button"
            className={`nav-link ${currentRoute === 'contracts' ? 'active' : ''}`}
            onClick={() => onNavigate && onNavigate('contracts')}
          >
            Contracts
          </button>
        </nav>

        {/* Right Action: + Ingest */}
        <div className="header-actions">
          <button
            type="button"
            className="btn-ingest"
            onClick={onOpenIngest}
            title="Ingest new contract document"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Ingest</span>
          </button>
        </div>
      </div>
    </header>
  )
}
