import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Users, Upload, Database, Star, Calendar,
  LogOut, PhoneCall, BarChart2, PhoneOff, Clock, X
} from 'lucide-react';

const Sidebar = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = user?.role || 'agent';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/workflow', icon: PhoneCall, label: 'Agent Workflow', roles: ['agent'] },
    { path: '/users', icon: Users, label: 'User Management', roles: ['admin'] },
    { path: '/upload', icon: Upload, label: 'Data Import', roles: ['admin', 'tl'] },
    { path: '/contacts', icon: Database, label: 'All Contacts', roles: ['admin', 'tl'] },
    { path: '/leads', icon: Star, label: 'Lead Tracking' },
    { path: '/appointments', icon: Calendar, label: 'Appointments' },
    { path: '/callbacks', icon: Clock, label: 'Callbacks' },
    { path: '/hungup', icon: PhoneOff, label: 'Hung Up Calls', roles: ['admin', 'tl'] },
    { path: '/reports', icon: BarChart2, label: 'Reports', roles: ['admin', 'tl'] },
  ];

  const filteredItems = navItems.filter(item => !item.roles || item.roles.includes(role));

  return (
    <>
      {/* Backdrop for mobile devices */}
      {isOpen && (
        <div
          className="mobile-backdrop"
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000
          }}
        />
      )}

      <aside
        className={`simple-sidebar ${isOpen ? 'open' : ''}`}
        style={{
          width: '260px', height: '100vh', background: '#ffffff',
          borderRight: '1px solid #e5e7eb', position: 'fixed',
          left: 0, top: 0, zIndex: 1001, display: 'flex', flexDirection: 'column',
          transition: 'transform 0.3s ease'
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--primary), var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
              <img src="/favicon.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#111827', margin: 0, letterSpacing: '-0.02em' }}>SPIKE CRM</h2>
          </div>
          <button className="mobile-close-btn" onClick={onClose} style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* User Info */}
        <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12, background: '#f9fafb' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
            {getInitials(user?.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'capitalize' }}>{role}</div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '16px 12px', overflowY: 'auto' }}>
          {filteredItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => { if (window.innerWidth <= 1024) onClose(); }}
                className={({ isActive }) => `simple-nav-link ${isActive ? 'active' : ''}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  borderRadius: '8px', textDecoration: 'none', color: '#4b5563',
                  fontSize: '0.9375rem', fontWeight: 500, marginBottom: '4px',
                  transition: 'background 0.2s'
                }}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Separate Logout Button */}
        <div style={{ padding: '20px', borderTop: '1px solid #f3f4f6' }}>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 10, padding: '12px', borderRadius: '8px', background: '#ef4444',
              color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.1)'
            }}
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <style>{`
        .simple-nav-link:hover {
          background: #f3f4f6;
          color: #111827;
        }
        .simple-nav-link.active {
          background: #6366f1;
          color: #ffffff !important;
        }
        @media (max-width: 1024px) {
          .simple-sidebar {
            transform: translateX(-100%);
          }
          .simple-sidebar.open {
            transform: translateX(0);
          }
          .mobile-close-btn {
            display: block !important;
          }
        }
      `}</style>
    </>
  );
};

export default Sidebar;
