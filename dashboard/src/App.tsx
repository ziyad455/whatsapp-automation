import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-header">
          <NavLink className="brand" to="/login">
            WhatsApp Automation
          </NavLink>
          <nav aria-label="Primary navigation">
            <NavLink to="/login">Login</NavLink>
            <NavLink to="/dashboard">Dashboard</NavLink>
          </nav>
        </header>

        <main className="page-container">
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
