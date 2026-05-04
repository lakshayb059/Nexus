import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Upload from './pages/Upload';
import Contacts from './pages/Contacts';
import Reports from './pages/Reports';
import Workflow from './pages/Workflow';
import MyLeads from './pages/MyLeads';
import MyAppointments from './pages/MyAppointments';
import HungUp from './pages/HungUp';
import Layout from './components/Layout';
import AppointmentNotifier from './components/AppointmentNotifier';

// Protect routes based on authentication
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children ? children : <Outlet />;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Protected Routes wrapped in Layout */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/users" element={<Users />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/contacts" element={<Contacts filterType="all" />} />
            <Route path="/workflow" element={<Workflow />} />
            <Route path="/leads" element={<MyLeads />} />
            <Route path="/appointments" element={<MyAppointments />} />
            <Route path="/hungup" element={<HungUp />} />
            <Route path="/reports" element={<Reports />} />
          </Route>
        </Route>
      </Routes>
      <AppointmentNotifier />
    </Router>
  );
}

export default App;
