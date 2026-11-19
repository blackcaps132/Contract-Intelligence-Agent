import React, { useState, useEffect } from 'react'
import Header from './components/Header'
import HomePage from './pages/HomePage'
import ContractsPage from './pages/ContractsPage'
import ContractViewerPage from './pages/ContractViewerPage'

function parseRouteState() {
  const hash = window.location.hash.replace('#', '').trim()
  const path = window.location.pathname
  const combined = hash || (path.startsWith('/') ? path.slice(1) : path)
  const parts = combined.split('/').filter(Boolean)

  if (parts[0] === 'contracts' && parts[1]) {
    return {
      route: 'contract-detail',
      contractId: parts[1],
      tab: parts[2] || 'read',
    }
  }
  if (parts[0] === 'contracts') {
    return { route: 'contracts', contractId: null, tab: 'read' }
  }
  return { route: 'home', contractId: null, tab: 'read' }
}

export default function App() {
  const [routeState, setRouteState] = useState(parseRouteState)

  useEffect(() => {
    const handlePopState = () => {
      setRouteState(parseRouteState())
    }
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('hashchange', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('hashchange', handlePopState)
    }
  }, [])

  const navigateTo = (route) => {
    const targetUrl = route === 'home' ? '/' : '#contracts'
    window.history.pushState({}, '', targetUrl)
    setRouteState({ route, contractId: null, tab: 'read' })
  }

  const navigateToContract = (contractId, tab = 'read') => {
    const targetUrl = `#contracts/${contractId}/${tab}`
    window.history.pushState({}, '', targetUrl)
    setRouteState({ route: 'contract-detail', contractId, tab })
  }

  const handleOpenIngest = () => {
    // Ingest modal opens in Step 9 per roadmap
    console.info('[Ingest] Ingest modal triggered')
  }

  // Determine active header navigation link
  const activeHeaderNav =
    routeState.route === 'contract-detail' || routeState.route === 'contracts'
      ? 'contracts'
      : 'home'

  return (
    <div className="app-shell">
      <Header
        currentRoute={activeHeaderNav}
        onNavigate={navigateTo}
        onOpenIngest={handleOpenIngest}
      />

      {routeState.route === 'home' && (
        <HomePage
          onNavigate={navigateTo}
          onSelectContract={(id) => navigateToContract(id, 'read')}
        />
      )}

      {routeState.route === 'contracts' && (
        <ContractsPage
          onSelectContract={(id, tab) => navigateToContract(id, tab || 'read')}
        />
      )}

      {routeState.route === 'contract-detail' && (
        <ContractViewerPage
          contractId={routeState.contractId}
          initialTab={routeState.tab}
          onBack={() => navigateTo('contracts')}
        />
      )}
    </div>
  )
}
