import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import Splash from './pages/Splash';
import Login from './pages/Login';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import PatientList from './pages/PatientList';
import PatientNew from './pages/PatientNew';
import PatientDetail from './pages/PatientDetail';
import EncounterPage from './pages/EncounterPage';
import SessionEnd from './pages/SessionEnd';
import AdminPage from './pages/AdminPage';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // Admins are confined to /admin — no clinical UI
  if (user.role === 'admin' && !window.location.pathname.startsWith('/admin')) {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"               element={<Splash />} />
          <Route path="/login"          element={<Login />} />
          <Route path="/register"       element={<Register />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/admin" element={<AdminOnly><AdminPage /></AdminOnly>} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route path="/dashboard"            element={<Dashboard />} />
            <Route path="/patients"             element={<PatientList />} />
            <Route path="/patients/new"         element={<PatientNew />} />
            <Route path="/patients/:id"         element={<PatientDetail />} />
            <Route path="/encounters/:id"       element={<EncounterPage />} />
            <Route path="/session-end/:id?"     element={<SessionEnd />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
