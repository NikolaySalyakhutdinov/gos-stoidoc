import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './store/AuthStore'
import { ThemeProvider } from './store/ThemeStore'
import { VerificationProvider } from './store/VerificationStore'
import RequireAuth from './components/RequireAuth'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CreateObject from './pages/CreateObject'
import ObjectOverview from './pages/ObjectOverview'
import UploadPage from './pages/UploadPage'
import Protocol from './pages/Protocol'
import Verify from './pages/Verify'
import MatrixPage from './pages/MatrixPage'
import AuditPage from './pages/AuditPage'
import Settings from './pages/Settings'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'

function PublicOnly({ children }) {
  const { isAuthenticated, authLoading } = useAuth()
  if (authLoading) return null
  if (isAuthenticated) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <VerificationProvider>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />

            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/objects/new" element={<CreateObject />} />
              <Route path="/objects/:id" element={<ObjectOverview />} />
              <Route path="/objects/:id/upload" element={<UploadPage />} />
              <Route path="/objects/:id/protocol" element={<Protocol />} />
              <Route path="/objects/:id/verify/:findingId" element={<Verify />} />
              <Route path="/matrix" element={<MatrixPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </VerificationProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
