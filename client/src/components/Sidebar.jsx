import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Users, Upload, Database, Star, Calendar,
  Layers, Download, LogOut, Sparkles, X, ChevronLeft, ChevronRight,
  PhoneCall, BarChart2, PhoneOff, Clock
} from 'lucide-react';

const Sidebar = ({ isOpen, onClose, isCollapsed, setIsCollapsed }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = user?.role || 'agent';

  const handleLogout = () => { logout(); navigate('/login'); };

  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  const roleColor = role === 'admin' ? '#f59e0b' : role === 'tl' ? '#6366f1' : '#10b981';
  const roleLabel = role === 'admin' ? 'Admin Panel' : role === 'tl' ? 'Team Lead' : 'Agent';

  const adminItems = [
    { path: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/users',        icon: Users,           label: 'Users' },
    { path: '/upload',       icon: Upload,          label: 'Upload Data' },
    { path: '/contacts',     icon: Database,        label: 'All Contacts' },
    { path: '/leads',        icon: Star,            label: 'Leads' },
    { path: '/appointments', icon: Calendar,        label: 'Appointments' },
    { path: '/callbacks',    icon: Clock,           label: 'Callbacks' },
    { path: '/hungup',       icon: PhoneOff,        label: 'Hung Up' },
    { path: '/reports',      icon: BarChart2,       label: 'Reports' },
  ];

  const tlItems = [
    { path: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/upload',       icon: Upload,          label: 'Upload Data' },
    { path: '/contacts',     icon: Database,        label: 'Team Contacts' },
    { path: '/leads',        icon: Star,            label: 'Leads' },
    { path: '/appointments', icon: Calendar,        label: 'Appointments' },
    { path: '/callbacks',    icon: Clock,           label: 'Callbacks' },
    { path: '/hungup',       icon: PhoneOff,        label: 'Hung Up' },
    { path: '/reports',      icon: BarChart2,       label: 'Reports' },
  ];

  const agentItems = [
    { path: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/workflow',     icon: PhoneCall,       label: 'Workflow' },
    { path: '/leads',        icon: Star,            label: 'My Leads' },
    { path: '/appointments', icon: Calendar,        label: 'My Appointments' },
    { path: '/callbacks',    icon: Clock,           label: 'My Callbacks' },
  ];

  const items = role === 'admin' ? adminItems : role === 'tl' ? tlItems : agentItems;
  const w = isCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)';

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 998,
          }}
        />
      )}

      <aside className={`crm-sidebar${isOpen ? ' sidebar-open' : ''}`} style={{ width: w }}>
        <button
          className="sidebar-collapse-btn hide-tablet"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>

        <div className="sidebar-brand">
          <div className="sidebar-logo" style={{ background: '#fff', padding: '6px' }}>
            <img src="/favicon.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          {!isCollapsed && (
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-name">SPIKE CRM</span>
              <span className="sidebar-brand-role" style={{ color: roleColor }}>{roleLabel}</span>
            </div>
          )}
          {!isCollapsed && (
            <button className="btn btn-ghost btn-icon sidebar-close-mobile" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                title={isCollapsed ? item.label : ''}
                onClick={() => { if (window.innerWidth <= 1024) onClose(); }}
                className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
                style={isCollapsed ? { justifyContent: 'center' } : {}}
              >
                <Icon size={19} className="sidebar-nav-icon" />
                {!isCollapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-logout-section" style={isCollapsed ? { padding: '12px 0', justifyContent: 'center' } : {}}>
          <button className="sidebar-logout-btn" onClick={handleLogout} title="Logout">
            <LogOut size={18} />
            {!isCollapsed && <span>Sign Out</span>}
          </button>
        </div>

        <div className="sidebar-footer" style={isCollapsed ? { padding: '16px 0', justifyContent: 'center' } : {}}>
          <div className="avatar avatar-md sidebar-avatar" style={{ background: `${roleColor}22`, color: roleColor, flexShrink: 0 }}>
            {getInitials(user?.name)}
          </div>
          {!isCollapsed && (
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name}</div>
              <div className="sidebar-user-handle">@{user?.username}</div>
            </div>
          )}
        </div>
      </aside>

      <style>{`
        .crm-sidebar {
          height: 100vh;
          background: rgba(255,255,255,0.88);
          backdrop-filter: blur(24px) saturate(180%);
          border-right: 1px solid var(--border);
          box-shadow: 4px 0 24px rgba(37,99,235,0.07);
          display: flex;
          flex-direction: column;
          position: fixed;
          left: 0; top: 0;
          z-index: 999;
          transition: width var(--t-base) var(--ease);
          overflow: hidden;
        }
        .sidebar-collapse-btn {
          position: absolute;
          right: -12px; top: 28px;
          width: 24px; height: 24px;
          border-radius: 50%;
          background: var(--primary);
          color: #fff;
          border: 2px solid #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          z-index: 10;
          box-shadow: var(--shadow-primary);
        }
        .sidebar-brand {
          display: flex; align-items: center; gap: 12px;
          padding: 20px 16px;
          border-bottom: 1px solid var(--border);
          min-height: var(--header-height);
          background: rgba(37,99,235,0.03);
        }
        .sidebar-logo { width: 36px; height: 36px; border-radius: var(--r-md); display: flex; align-items: center; justify-content: center; }
        .sidebar-brand-name { font-size: 0.95rem; font-weight: 800; color: var(--text-primary); white-space: nowrap; }
        .sidebar-brand-role { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
        .sidebar-nav { flex: 1; overflow-y: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 2px; }
        .sidebar-nav-item { display: flex; align-items: center; gap: 11px; padding: 10px 12px; border-radius: var(--r-md); color: var(--text-secondary); font-size: 0.875rem; transition: all var(--t-fast); white-space: nowrap; }
        .sidebar-nav-item:hover { background: rgba(37,99,235,0.07); color: var(--primary); }
        .sidebar-nav-item.active { background: var(--primary-light); color: var(--primary); font-weight: 700; }
        .sidebar-footer { padding: 14px 16px; border-top: 1px solid var(--border); background: rgba(37,99,235,0.03); display: flex; align-items: center; gap: 10px; }
        .sidebar-logout-section { padding: 12px 16px; border-top: 1px solid var(--border); }
        .sidebar-logout-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px; border-radius: var(--r-md); background: var(--danger-light); color: var(--danger); border: 1px solid var(--danger-light); cursor: pointer; font-weight: 700; }
        @media (max-width: 1024px) {
          .crm-sidebar { transform: translateX(-100%); width: var(--sidebar-width) !important; }
          .crm-sidebar.sidebar-open { transform: translateX(0); }
          .sidebar-close-mobile { display: flex !important; }
        }
      `}</style>
    </>
  );
};

export default Sidebar;
