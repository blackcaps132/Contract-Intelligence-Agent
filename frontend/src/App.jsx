import React, { useState, useEffect } from 'react'
import Header from './components/Header'
import HomePage from './pages/HomePage'
import ContractsPage from './pages/ContractsPage'

export default function App() {
  const [currentRoute, setCurrentRoute] = useState(() => {
    const path = window.location.pathname
    const hash = window.location.hash.replace('#', '').trim()
    if (path.startsWith('/contracts') || hash === 'contracts') {
      return 'contracts'
    }
    return 'home'
  })

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname
      const hash = window.location.hash.replace('#', '').trim()
      if (path.startsWith('/contracts') || hash === 'contracts') {
        setCurrentRoute('contracts')
      } else {
        setCurrentRoute('home')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const handleNavigate = (route) => {
    setCurrentRoute(route)
    const targetUrl = route === 'home' ? '/' : '#contracts'
    window.history.pushState({}, '', targetUrl)
  }

  const handleOpenIngest = () => {
    // Ingest modal opens in Step 9 per roadmap
    console.info('[Ingest] Ingest modal triggered')
  }

  return (
    <div className="app-shell">
      <Header 
        currentRoute={currentRoute} 
        onNavigate={handleNavigate} 
        onOpenIngest={handleOpenIngest} 
      />
      {currentRoute === 'home' && (
        <HomePage 
          onNavigate={handleNavigate} 
          onSelectContract={(id) => handleNavigate('contracts')} 
        />
      )}
      {currentRoute === 'contracts' && (
        <ContractsPage 
          onSelectContract={(contractId, tab = 'read') => {
            console.info(`[App] Contract selected: ${contractId}, tab: ${tab}`)
            // In Step 4, this transitions to the Contract Reader room
          }} 
        />
      )}
    </div>
  )
}
