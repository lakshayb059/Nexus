import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import {
  Users, PhoneCall, Star, Calendar, Clock,
  XCircle, TrendingUp, Database, RefreshCw, PhoneOff, AlertCircle
} from 'lucide-react';

/* ── Skeleton card ── */
const SkeletonCard = () => (
  <div className="glass-panel" style={{ padding: 'var(--card-p)', overflow: 'hidden' }}>
    <div className="skeleton" style={{ height: 14, width: '60%', marginBottom: 20 }} />
    <div className="skeleton" style={{ height: 36, width: '45%', marginBottom: 12 }} />
    <div className="skeleton" style={{ height: 12, width: '70%' }} />
  </div>
);

/* ── Stat card ── */
const StatCard = ({ title, value, subtext, icon: Icon, accent, delay = 0 }) => (
  <div
    className="glass-panel stat-card"
    style={{ padding: 'var(--card-p)', animationDelay: `${delay}ms` }}
  >
    <div className="stat-card-top">
      <span className="stat-card-title">{title}</span>
      <div className="stat-card-icon" style={{ background: `${accent}18`, color: accent }}>
        <Icon size={18} />
      </div>
    </div>
    <div className="stat-card-value">{value}</div>
    <div className="stat-card-sub">{subtext}</div>
    {/* Decorative glow blob */}
    <div style={{
      position: 'absolute', bottom: -20, right: -20,
      width: 100, height: 100,
      background: accent, opacity: 0.06,
      borderRadius: '50%', filter: 'blur(24px)',
      pointerEvents: 'none',
    }} />
  </div>
);

const Dashboard = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [stats, setStats]   = useState(null);
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const statsRes = await api.get('/contacts/stats');
      setStats({ ...statsRes.data, totalLeadValue: statsRes.data.totalLeadAmount || 0 });
      if (user?.role !== 'agent') {
        const queuesRes = await api.get('/contacts/agent-queues');
        setQueues(queuesRes.data || []);
      }
    } catch (err) {
      console.error('Dashboard fetch failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    if (!socket) return;
    const events = [
      'contacts_updated', 'contact_disposed', 'lead_disposed',
      'dashboard_update', 'batch_uploaded', 'users_updated',
      'appointment_scheduled', 'appointment_cancelled',
    ];
    const handler = () => fetchDashboardData(true);
    events.forEach(e => socket.on(e, handler));
    return () => events.forEach(e => socket.off(e, handler));
  }, [socket, user]);

  const statCards = stats ? [
    { title: 'Total Contacts',   value: stats.total || 0,                         subtext: 'In system',               icon: Users,     accent: '#6366f1' },
    { title: 'Pending Queue',    value: stats.pending || 0,                        subtext: 'Awaiting disposition',    icon: Clock,     accent: '#f59e0b' },
    { title: 'Leads Converted',  value: stats.lead || 0,                           subtext: 'Total leads',             icon: Star,      accent: '#10b981' },
    { title: 'Total Revenue',    value: `₹${(stats.totalLeadValue || 0).toLocaleString()}`, subtext: 'Aggregate lead value', icon: TrendingUp, accent: '#8b5cf6' },
    { title: 'Appointments',     value: stats.appointment || 0,                    subtext: 'Scheduled',               icon: Calendar,  accent: '#a855f7' },
    { title: 'Call Backs',       value: stats.callBack || 0,                       subtext: 'Follow-up required',      icon: PhoneCall, accent: '#06b6d4' },
    { title: 'Invalid / Wrong No.', value: stats.invalid || 0,                     subtext: 'Bad contact info',        icon: AlertCircle, accent: '#f97316' },
    { title: 'Hung Up / Failed', value: stats.hungUp || 0,                         subtext: 'Max attempts reached',    icon: PhoneOff,  accent: '#ef4444' },
    { title: 'Do Not Call',      value: stats.doNotCall || 0,                      subtext: 'Excluded contacts',       icon: XCircle,   accent: '#64748b' },
  ] : [];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>Dashboard</h1>
          <p className="page-subtitle">
            Welcome back, <strong style={{ color: 'var(--text-primary)' }}>{user?.name}</strong>. Here's what's happening today.
          </p>
        </div>
        <button
          className="btn btn-outline"
          onClick={() => fetchDashboardData(true)}
          disabled={refreshing || loading}
          style={{ gap: 7 }}
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          <span className="hide-mobile">Refresh</span>
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid-stats" style={{ marginBottom: 'var(--gap)' }}>
        {loading
          ? Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((c, i) => (
              <StatCard key={c.title} {...c} delay={i * 50} />
            ))
        }
      </div>

      {/* Agent queue table */}
      {!loading && user?.role !== 'agent' && queues.length > 0 && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <div style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={17} style={{ color: 'var(--primary)' }} /> Agent Queue Status
            </h2>
            <span className="badge badge-primary">{queues.length} agents</span>
          </div>

          <div className="table-responsive">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  {user?.role === 'admin' && <th>Team Lead</th>}
                  <th>Total</th>
                  <th>Pending</th>
                  <th>Disposed</th>
                  <th>Leads</th>
                  <th>Lead Value</th>
                  <th>Appts</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(queues) && queues.map((q, i) => {
                  const progress = q.total > 0 ? Math.round((q.disposed / q.total) * 100) : 0;
                  return (
                    <tr key={i}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            className="avatar avatar-sm"
                            style={{ background: 'var(--primary-light)', color: 'var(--primary)', fontSize: '0.7rem', fontWeight: 800 }}
                          >
                            {q.agent?.name?.charAt(0) || 'U'}
                          </div>
                          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{q.agent?.name || 'Unknown'}</span>
                        </div>
                      </td>
                      {user?.role === 'admin' && (
                        <td>
                          <span className="badge badge-warning">{q.tlName || '—'}</span>
                        </td>
                      )}
                      <td style={{ fontWeight: 600 }}>{q.total || 0}</td>
                      <td><span style={{ color: 'var(--warning)', fontWeight: 700 }}>{q.pending || 0}</span></td>
                      <td>{q.disposed || 0}</td>
                      <td><span style={{ color: 'var(--success)', fontWeight: 700 }}>{q.lead || 0}</span></td>
                      <td style={{ fontWeight: 700 }}>₹{(q.totalLeadAmount || 0).toLocaleString()}</td>
                      <td><span style={{ color: 'var(--violet)', fontWeight: 700 }}>{q.appointment || 0}</span></td>
                      <td style={{ minWidth: 120 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="progress-bar-track" style={{ flex: 1 }}>
                            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: 36 }}>
                            {progress}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .stat-card {
          position: relative;
          overflow: hidden;
          animation: fadeUp var(--t-slow) var(--ease) both;
          transition: transform var(--t-base), box-shadow var(--t-base);
        }
        .stat-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px rgba(0,0,0,0.4);
        }
        .stat-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .stat-card-title {
          font-size: 0.78rem;
          font-weight: 700;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .stat-card-icon {
          width: 36px; height: 36px;
          border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
        }
        .stat-card-value {
          font-size: clamp(1.7rem, 4vw, 2.2rem);
          font-weight: 800;
          color: var(--text-primary);
          margin-bottom: 6px;
          line-height: 1;
        }
        .stat-card-sub {
          font-size: 0.78rem;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
};

export default Dashboard;
