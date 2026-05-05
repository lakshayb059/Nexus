import React, { useState } from 'react';
import { Outlet, useLocation, NavLink } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import { useAuth } from '../contexts/AuthContext';
import {
  Menu, Sparkles, Bell,
  LayoutDashboard, PhoneCall, Star, Calendar, MoreHorizontal
} from 'lucide-react';

/* Page title map */
const PAGE_TITLES = {
  '/dashboard':    'Dashboard',
  '/users':        'User Management',
  '/upload':       'Data Import',
  '/contacts':     'All Contacts',
  '/workflow':     'Agent Workflow',
  '/leads':        'My Leads',
  '/appointments': 'My Appointments',
  '/reports':      'Reports & Export',
};

const Layout = () => {
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [isCollapsed, setIsCollapsed]     = useState(false);
  const { user } = useAuth();
  const location = useLocation();

  const role = user?.role || 'agent';
  const pageTitle = PAGE_TITLES[location.pathname] || 'Spike CRM';

  /* Mobile bottom-nav items per role */
  const mobileNav = role === 'agent'
    ? [
        { path: '/dashboard',    icon: LayoutDashboard, label: 'Home' },
        { path: '/workflow',     icon: PhoneCall,       label: 'Workflow' },
        { path: '/leads',        icon: Star,            label: 'Leads' },
        { path: '/appointments', icon: Calendar,        label: 'Appts' },
      ]
    : [
        { path: '/dashboard',    icon: LayoutDashboard, label: 'Home' },
        { path: '/contacts',     icon: Star,            label: 'Contacts' },
        { path: '/leads',        icon: Star,            label: 'Leads' },
        { path: '/reports',      icon: MoreHorizontal,  label: 'More' },
      ];

  return (
    <div className="layout-root">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
      />

      {/* Main wrapper — shifts right on desktop */}
      <div
        className="layout-main"
        style={{
          '--sidebar-offset': isCollapsed
            ? 'var(--sidebar-collapsed-width)'
            : 'var(--sidebar-width)',
        }}
      >
        {/* ── Top Bar ── */}
        <header className="topbar">
          {/* Mobile: hamburger */}
          <div className="topbar-left">
            <button
              className="btn btn-ghost btn-icon topbar-hamburger"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              style={{ position: 'relative' }}
            >
              <Menu className="hamburger-icon-responsive" />
            </button>
            {/* Page title (visible on all screens now) */}
            <h1 className="topbar-page-title" style={{ fontSize: 'clamp(0.95rem, 4vw, 1.15rem)' }}>{pageTitle}</h1>
          </div>

          <div className="topbar-right">
            {/* Notification Bell */}
            <NotificationBell />

            {/* Live indicator */}
            <div className="topbar-live-pill">
              <span className="live-dot" />
              <span className="hide-mobile">Live</span>
            </div>

            {/* Role chip */}
            <div
              className="topbar-role-chip"
              style={{
                background: role === 'admin'
                  ? 'rgba(245,158,11,0.12)'
                  : role === 'tl'
                  ? 'var(--primary-light)'
                  : 'var(--success-light)',
                color: role === 'admin' ? '#f59e0b' : role === 'tl' ? 'var(--primary)' : 'var(--success)',
              }}
            >
              {role === 'admin' ? 'Admin' : role === 'tl' ? 'Team Lead' : 'Agent'}
            </div>
          </div>
        </header>

        {/* ── Page content ── */}
        <main className="layout-content">
          <div className="layout-content-inner animate-fade-up">
            <Outlet />
          </div>
        </main>

        {/* ── Mobile Bottom Navigation ── */}
        <nav className="bottom-nav">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `bottom-nav-item${isActive ? ' active' : ''}`
                }
              >
                <Icon size={22} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <style>{`
        .layout-root {
          display: flex;
          min-height: 100vh;
          background: var(--bg-base);
        }

        /* Main area */
        .layout-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          height: 100vh;
          overflow: hidden;
        }

        /* Desktop: offset for sidebar */
        @media (min-width: 1025px) {
          .layout-main {
            margin-left: var(--sidebar-offset);
            transition: margin-left var(--t-base) var(--ease);
          }
        }

        /* ── Top Bar ── */
        .topbar {
          height: var(--header-height);
          background: rgba(255,255,255,0.8);
          backdrop-filter: blur(24px) saturate(200%);
          -webkit-backdrop-filter: blur(24px) saturate(200%);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          flex-shrink: 0;
          z-index: 1000;
          position: sticky;
          top: 0;
        }
        .topbar-left  { display: flex; align-items: center; gap: clamp(8px, 3vw, 14px); }
        .topbar-right { display: flex; align-items: center; gap: clamp(8px, 2.5vw, 12px); }

        .topbar-hamburger { display: none; }
        .hamburger-icon-responsive { width: 22px; height: 22px; }
        @media (max-width: 1024px) {
          .topbar-hamburger { display: flex; }
        }
        @media (max-width: 640px) {
          .topbar-hamburger { width: 44px!important; height: 44px!important; }
          .hamburger-icon-responsive { width: 30px!important; height: 30px!important; }
        }

        .topbar-brand-mobile {
          display: none;
          align-items: center;
          gap: 8px;
          font-weight: 800;
          font-size: 0.95rem;
        }
        @media (max-width: 1024px) {
          .topbar-brand-mobile { display: flex; }
        }

        .topbar-logo {
          width: 28px; height: 28px;
          border-radius: 7px;
          background: linear-gradient(135deg, var(--primary), var(--violet));
          display: flex; align-items: center; justify-content: center;
          color: #fff;
        }

        .topbar-page-title {
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        /* Live pill */
        .topbar-live-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: var(--r-full);
          background: rgba(5,150,105,0.10);
          color: var(--success);
          font-size: 0.72rem;
          font-weight: 700;
          border: 1px solid rgba(5,150,105,0.18);
        }
        .live-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--success);
          animation: pulseRing 2s infinite;
        }

        /* Role chip */
        .topbar-role-chip {
          padding: 5px 12px;
          border-radius: var(--r-full);
          font-size: 0.7rem;
          font-weight: 800;
          text-transform: capitalize;
        }

        @media (max-width: 640px) {
          .topbar { padding: 0 16px; }
          .topbar-live-pill { padding: 5px 12px; font-size: 0.7rem; }
          .topbar-role-chip { display: none; }
        }

        /* ── Content area ── */
        .layout-content {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 0;
        }
        /* Pad bottom on mobile for bottom nav */
        @media (max-width: 1024px) {
          .layout-content { padding-bottom: var(--bottom-nav-height); }
        }
        .layout-content-inner {
          max-width: 1600px;
          margin: 0 auto;
          padding: var(--page-py) var(--page-px);
          animation: revealUp var(--t-slow) var(--ease) forwards;
        }

        /* ── Bottom Navigation (mobile only) ── */
        .bottom-nav {
          display: none;
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: var(--bottom-nav-height);
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border-top: 1px solid var(--border);
          box-shadow: 0 -4px 20px rgba(37,99,235,0.08);
          z-index: 900;
        }
        @media (max-width: 1024px) {
          .bottom-nav {
            display: flex;
            align-items: stretch;
          }
        }
        .bottom-nav-item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          text-decoration: none;
          color: var(--text-muted);
          font-size: 0.62rem;
          font-weight: 700;
          transition: color var(--t-fast);
          padding: 6px 4px;
        }
        .bottom-nav-item.active { color: var(--primary); }
        .bottom-nav-item:hover  { color: var(--text-secondary); }
      `}</style>
    </div>
  );
};

export default Layout;
