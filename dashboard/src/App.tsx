import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import './App.css'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { DashboardLayout } from './layout/DashboardLayout'
import { AgentChatPage } from './pages/AgentChatPage'
import { BusinessProfilePage } from './pages/BusinessProfilePage'
import { BusinessRulesPage } from './pages/BusinessRulesPage'
import { BusinessUnderstandingPage } from './pages/BusinessUnderstandingPage'
import { EntityFormPage } from './pages/EntityFormPage'
import { EntityListPage } from './pages/EntityListPage'
import { EntityTypesPage } from './pages/EntityTypesPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OpeningHoursPage } from './pages/OpeningHoursPage'
import { SchemaEditorPage } from './pages/SchemaEditorPage'

function PublicLayout() {
  return (
    <div className="public-shell">
      <header className="public-header">
        <NavLink className="brand" to="/login">WhatsApp Automation</NavLink>
      </header>
      <main className="public-main"><Outlet /></main>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicLayout />}>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<BusinessProfilePage />} />
            <Route path="hours" element={<OpeningHoursPage />} />
            <Route path="rules" element={<BusinessRulesPage />} />
            <Route path="data" element={<EntityTypesPage />} />
            <Route path="data/:entityTypeKey" element={<EntityListPage />} />
            <Route path="data/:entityTypeKey/new" element={<EntityFormPage />} />
            <Route path="data/:entityTypeKey/:entityId/edit" element={<EntityFormPage />} />
            <Route path="schema/:entityTypeKey" element={<SchemaEditorPage />} />
            <Route path="understanding" element={<BusinessUnderstandingPage />} />
            <Route path="agent-chat" element={<AgentChatPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
