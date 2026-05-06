import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import {
  Users, PhoneCall, Star, Calendar, Clock,
  XCircle, TrendingUp, Database, RefreshCw, PhoneOff,
  AlertCircle, ArrowUpRight, Activity, Zap
} from 'lucide-react';

/* ─────────────────────────────────────────
   SKELETON LOADER
───────────────────────────────────────── */
const SkeletonCard = () => (
  <div style={{
    background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.8)',
    borderRadius: 20, padding: 22, overflow: 'hidden',
    boxShadow: '0 10px 30px -12px rgba(0,0,0,0.06)'
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 54, height: 54, borderRadius: 18, background: 'linear-gradient(90deg,#f0f4ff 25%,#e0e8ff 50%,#f0f4ff 75%)', backgroundSize: '300% 100%', animation: 'shimmer 1.4s infinite' }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 10, width: '55%', background: 'linear-gradient(90deg,#f0f4ff 25%,#e0e8ff 50%,#f0f4ff 75%)', backgroundSize: '300% 100%', animation: 'shimmer 1.4s infinite', borderRadius: 6, marginBottom: 10 }} />
        <div style={{ height: 28, width: '40%', background: 'linear-gradient(90deg,#f0f4ff 25%,#e0e8ff 50%,#f0f4ff 75%)', backgroundSize: '300% 100%', animation: 'shimmer 1.4s infinite', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 9, width: '70%', background: 'linear-gradient(90deg,#f0f4ff 25%,#e0e8ff 50%,#f0f4ff 75%)', backgroundSize: '300% 100%', animation: 'shimmer 1.4s infinite', borderRadius: 6 }} />
      </div>
    </div>
  </div>
);

/* ─────────────────────────────────────────
   PREMIUM STAT CARD
───────────────────────────────────────── */
const StatCard = ({ title, value, subtext, icon: Icon, accent, delay = 0 }) => (
  <div className="stat-card-premium" style={{ animationDelay: `${delay}ms` }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(10px, 2vw, 18px)', position: 'relative', zIndex: 2 }}>
      <div style={{
        width: 'clamp(40px, 5vw, 52px)', 
        height: 'clamp(40px, 5vw, 52px)', 
        borderRadius: 'var(--r-md)', 
        flexShrink: 0,
        background: `${accent}14`, color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }} className="stat-icon-hover">
        <Icon size={20} strokeWidth={2.2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
          {title}
        </div>
        <div style={{ fontSize: 'clamp(1.4rem, 4vw, 1.9rem)', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-0.03em' }}>
          {value}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, marginTop: 4 }}>
          {subtext}
        </div>
      </div>
    </div>
    <div style={{
      position: 'absolute', top: -15, right: -15, width: 80, height: 80,
      borderRadius: '50%', background: accent, filter: 'blur(30px)', opacity: 0.08, zIndex: 1, pointerEvents: 'none'
    }} />
  </div>
);

/* ─────────────────────────────────────────
   SECTION DIVIDER
───────────────────────────────────────── */
const SectionLabel = ({ icon: Icon, label, accent = '#2563eb' }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, marginTop: 4 }}>
    <div style={{ width: 28, height: 28, borderRadius: 8, background: `${accent}14`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={14} strokeWidth={2.5} />
    </div>
    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
    <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(37,99,235,0.1), transparent)' }} />
  </div>
);

/* ─────────────────────────────────────────
   MAIN DASHBOARD
───────────────────────────────────────── */
const Dashboard = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [stats, setStats]     = useState(null);
  const [queues, setQueues]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardData = async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [statsRes, callbacksRes] = await Promise.all([
        api.get('/contacts/stats'),
        api.get('/leads/callbacks')
      ]);
      setStats({ 
        ...statsRes.data, 
        totalLeadValue: statsRes.data.totalLeadAmount || 0,
        callbacksPageCount: callbacksRes.data ? callbacksRes.data.length : 0
      });
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
    const events = ['contacts_updated','contact_disposed','lead_disposed','dashboard_update','batch_uploaded','users_updated','appointment_scheduled','appointment_cancelled'];
    const handler = () => fetchDashboardData(true);
    events.forEach(e => socket.on(e, handler));
    return () => events.forEach(e => socket.off(e, handler));
  }, [socket, user]);

  const primaryCards = stats ? [
    { title: 'Total Contacts',  value: stats.total || 0,   subtext: 'In system',            icon: Users,     accent: '#6366f1' },
    { title: 'Pending Queue',   value: stats.pending || 0, subtext: 'Awaiting disposition',  icon: Clock,     accent: '#f59e0b' },
    { title: 'Leads Converted', value: stats.lead || 0,    subtext: 'Successfully closed',   icon: Star,      accent: '#10b981' },
    { title: 'Total Revenue',   value: `₹${(stats.totalLeadValue || 0).toLocaleString()}`, subtext: 'Aggregate lead value', icon: TrendingUp, accent: '#8b5cf6' },
  ] : [];

  const activityCards = stats ? [
    { title: 'Appointments', value: stats.appointment || 0, subtext: 'Scheduled',           icon: Calendar,    accent: '#a855f7' },
    { title: 'Call Backs',   value: stats.callbacksPageCount || 0, subtext: 'Follow-up required',   icon: PhoneCall,   accent: '#06b6d4' },
  ] : [];

  const negativeCards = stats ? [
    { title: 'Invalid / Wrong No.', value: stats.invalid   || 0, subtext: 'Bad contact info',     icon: AlertCircle, accent: '#f97316' },
    { title: 'Hung Up / Failed',    value: stats.hungUp    || 0, subtext: 'Max attempts reached', icon: PhoneOff,    accent: '#ef4444' },
    { title: 'Do Not Call',         value: stats.doNotCall || 0, subtext: 'Excluded contacts',    icon: XCircle,     accent: '#64748b' },
  ] : [];

  const skeletonCount = loading ? 9 : 0;

  return (
    <div style={{ animation: 'revealUp 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>

      {/* ── PAGE HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,var(--primary),var(--violet))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity size={16} color="#fff" strokeWidth={2.5} />
            </div>
            <h1 style={{ fontSize: 'var(--h1)', fontWeight: 900, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.03em' }}>
              Dashboard
            </h1>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, fontWeight: 500 }}>
            Welcome, <strong style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{user?.name}</strong>
          </p>
        </div>
        <button
          onClick={() => fetchDashboardData(true)}
          disabled={refreshing || loading}
          className="btn btn-outline"
          style={{ 
            fontSize: '0.8rem', 
            padding: '8px 14px',
            opacity: (refreshing || loading) ? 0.6 : 1
          }}
        >
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* ── PRIMARY KPI SECTION ── */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginBottom: 24 }}>
          {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          <SectionLabel icon={Zap} label="Key Metrics" accent="var(--primary)" />
          <div className="grid-stats" style={{ marginBottom: 24 }}>
            {primaryCards.map((c, i) => <StatCard key={c.title} {...c} delay={i * 60} />)}
          </div>

          <SectionLabel icon={Calendar} label="Active Follow-Ups" accent="var(--violet)" />
          <div className="grid-stats" style={{ marginBottom: 24 }}>
            {activityCards.map((c, i) => <StatCard key={c.title} {...c} delay={240 + i * 60} />)}
          </div>

          <SectionLabel icon={AlertCircle} label="Unresolved Contacts" accent="var(--danger)" />
          <div className="grid-stats" style={{ marginBottom: 24 }}>
            {negativeCards.map((c, i) => <StatCard key={c.title} {...c} delay={360 + i * 60} />)}
          </div>
        </>
      )}

      {/* ── AGENT QUEUE TABLE ── */}
      {!loading && user?.role !== 'agent' && queues.length > 0 && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(37,99,235,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Database size={15} color="var(--primary)" strokeWidth={2.5} />
              </div>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)' }}>Agent Performance</div>
              </div>
            </div>
            <div className="badge badge-primary">
              {queues.length} Agents
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(248,251,255,0.4)' }}>
                  {['Agent', user?.role === 'admin' && 'Team Lead', 'Total', 'Pending', 'Disposed', 'Leads', 'Revenue', 'Appts', 'Progress'].filter(Boolean).map(h => (
                    <th key={h} style={{ padding: '13px 20px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(37,99,235,0.06)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.isArray(queues) && queues.map((q, i) => {
                  const progress = q.total > 0 ? Math.round(((q.total - q.pending) / q.total) * 100) : 0;
                  const progressColor = progress >= 80 ? '#10b981' : progress >= 50 ? '#f59e0b' : '#ef4444';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(37,99,235,0.05)', transition: 'background 0.2s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,99,235,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: '50%',
                            background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.75rem', fontWeight: 800, flexShrink: 0
                          }}>
                            {q.agent?.name?.charAt(0)?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>{q.agent?.name || 'Unknown'}</div>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>Agent</div>
                          </div>
                        </div>
                      </td>
                      {user?.role === 'admin' && (
                        <td style={{ padding: '14px 20px' }}>
                          <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(217,119,6,0.1)', color: '#d97706', fontSize: '0.72rem', fontWeight: 800 }}>
                            {q.tlName || '—'}
                          </span>
                        </td>
                      )}
                      <td style={{ padding: '14px 20px', fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>{q.total || 0}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 800, fontSize: '0.82rem' }}>
                          {q.pending || 0}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', color: '#475569', fontWeight: 600, fontSize: '0.875rem' }}>{q.disposed || 0}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(16,185,129,0.1)', color: '#10b981', fontWeight: 800, fontSize: '0.82rem' }}>
                          {q.lead || 0}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', fontWeight: 800, color: '#7c3aed', fontSize: '0.875rem' }}>
                        ₹{(q.totalLeadAmount || 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(168,85,247,0.1)', color: '#a855f7', fontWeight: 800, fontSize: '0.82rem' }}>
                          {q.appointment || 0}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, height: 7, background: 'rgba(37,99,235,0.08)', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', width: `${progress}%`,
                              background: `linear-gradient(90deg, ${progressColor}, ${progressColor}aa)`,
                              borderRadius: 999, transition: 'width 0.6s ease'
                            }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: progressColor, minWidth: 36 }}>
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

      {/* ── INLINE STYLES ── */}
      <style>{`
        @keyframes revealUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          from { background-position: 200% 0; }
          to   { background-position: -200% 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .stat-card-premium {
          position: relative;
          overflow: hidden;
          padding: 22px;
          background: rgba(255,255,255,0.72);
          backdrop-filter: blur(16px) saturate(180%);
          -webkit-backdrop-filter: blur(16px) saturate(180%);
          border: 1px solid rgba(255,255,255,0.85);
          border-radius: 20px;
          box-shadow: 0 8px 30px -10px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04);
          animation: revealUp 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .stat-card-premium:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 50px -15px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.04);
        }
        .stat-card-premium:hover .stat-icon-hover {
          transform: scale(1.12) rotate(-6deg);
        }
        .stat-icon-hover {
          transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1) !important;
        }
        @media (max-width: 640px) {
          .stat-card-premium { padding: 16px; }
        }
      `}</style>
    </div>
  );
};

export default Dashboard;
