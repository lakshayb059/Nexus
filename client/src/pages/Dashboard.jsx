import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import {
  Users, PhoneCall, Star, Calendar, Clock,
  XCircle, TrendingUp, Database, RefreshCw, PhoneOff,
  AlertCircle, ArrowUpRight, Activity, Zap, Trash2, Settings, Save, X, Coffee, Filter
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import SuperAdminDashboard from './SuperAdminDashboard';
import BreakTimerOverlay from '../components/BreakTimerOverlay';

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
const StatCard = ({ title, value, subtext, icon: Icon, accent, delay = 0 }) => {
  const valStr = String(value || '');
  const fontSize = valStr.length > 12 
    ? 'clamp(1.05rem, 2.2vw, 1.25rem)' 
    : valStr.length > 8 
      ? 'clamp(1.18rem, 2.5vw, 1.45rem)' 
      : 'clamp(1.35rem, 3.2vw, 1.85rem)';

  return (
    <div className="stat-card-premium" style={{ animationDelay: `${delay}ms`, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.5vw, 14px)', position: 'relative', zIndex: 2 }}>
        <div style={{
          width: 'clamp(38px, 4vw, 48px)',
          height: 'clamp(38px, 4vw, 48px)',
          borderRadius: 'var(--r-md)',
          flexShrink: 0,
          background: `${accent}14`, color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} className="stat-icon-hover">
          <Icon size={20} strokeWidth={2.2} />
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div style={{ 
            fontSize, 
            fontWeight: 900, 
            color: 'var(--text-primary)', 
            lineHeight: 1.15, 
            letterSpacing: '-0.02em',
            wordBreak: 'break-word',
            overflowWrap: 'break-word'
          }}>
            {value}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
};

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
const formatDateStr = (date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const Dashboard = () => {
  const { user, updateUser, activeBreak, setActiveBreak } = useAuth();
  const { socket } = useSocket();
  const [stats, setStats] = useState(null);
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [agentCallsData, setAgentCallsData] = useState([]);

  const setQuickFilter = (type) => {
    const today = new Date();
    if (type === 'today') {
      const todayStr = formatDateStr(today);
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (type === 'yesterday') {
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      const yesterdayStr = formatDateStr(yesterday);
      setFromDate(yesterdayStr);
      setToDate(yesterdayStr);
    } else if (type === 'lastweek') {
      const lastWeekStart = new Date();
      lastWeekStart.setDate(today.getDate() - 7);
      setFromDate(formatDateStr(lastWeekStart));
      setToDate(formatDateStr(today));
    }
  };

  const handleStartBreak = async (type) => {
    try {
      const res = await api.post('/agent-logs/start-break', { breakType: type });
      setActiveBreak({
        type: type,
        startTime: res.data.activeBreakStart || new Date().toISOString()
      });
    } catch (err) {
      console.error('Failed to start break:', err);
      alert(err.response?.data?.error || 'Failed to start break');
    }
  };

  const handleEndBreak = async () => {
    try {
      await api.post('/agent-logs/end-break');
      setActiveBreak(null);
    } catch (err) {
      console.error('Failed to end break:', err);
      alert(err.response?.data?.error || 'Failed to end break');
    }
  };

  // Admin Settings State
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [receiverMail, setReceiverMail] = useState(user?.receiverMail || '');
  const [savingSettings, setSavingSettings] = useState(false);
  if (user?.role === 'superadmin') {
    return <SuperAdminDashboard />;
  }

  const fetchDashboardData = async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      let query = '';
      if (fromDate && toDate) {
        query = `?fromDate=${fromDate}&toDate=${toDate}`;
      }
      const statsRes = await api.get(`/contacts/stats${query}`);
      setStats({ ...statsRes.data, totalLeadValue: statsRes.data.totalLeadAmount || 0 });
      if (user?.role !== 'agent') {
        const [queuesRes, summaryRes] = await Promise.all([
          api.get('/contacts/agent-queues'),
          api.get(`/contacts/agent-calls-summary${query}`)
        ]);
        setQueues(queuesRes.data || []);
        setAgentCallsData(summaryRes.data || []);
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
    const events = ['contacts_updated', 'contact_disposed', 'lead_disposed', 'dashboard_update', 'batch_uploaded', 'users_updated', 'appointment_scheduled', 'appointment_cancelled'];
    const handler = () => fetchDashboardData(true);
    events.forEach(e => socket.on(e, handler));
    return () => events.forEach(e => socket.off(e, handler));
  }, [socket, user, fromDate, toDate]);

  const handleGlobalWipe = async () => {
    const confirmation = window.prompt("GLOBAL SYSTEM WIPE. This will delete EVERY record in the database except your superadmin account. Type 'DELETE' to confirm.");
    if (confirmation === 'DELETE') {
      try {
        await Promise.all([
          api.delete('/users/wipe'),
          api.delete('/contacts/wipe'),
          api.delete('/leads/wipe'),
          api.delete('/leads/appointments/wipe'),
          api.delete('/leads/callbacks/wipe')
        ]);
        alert('GLOBAL WIPE SUCCESSFUL. All data has been deleted.');
        window.location.reload();
      } catch (err) {
        alert('Failed during global wipe. Check console for details.');
        console.error(err);
      }
    }
  };

  const saveAdminSettings = async () => {
    if (!receiverMail) return alert('Please enter an email address');
    try {
      setSavingSettings(true);
      await api.put(`/users/${user._id || user.id}`, { 
        receiverMail
      });
      updateUser({ 
        ...user, 
        receiverMail
      });
      setShowAdminSettings(false);
      alert('Settings saved successfully');
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const overviewCards = stats ? [
    { title: 'Total Contacts', value: stats.total || 0, subtext: 'In system', icon: Users, accent: '#6366f1' },
    { title: 'Pending Queue', value: stats.pending || 0, subtext: 'Awaiting disposition', icon: Clock, accent: '#f59e0b' },
    { title: 'Calls Today', value: stats.todayCalls || 0, subtext: 'Real-time calls today', icon: PhoneCall, accent: '#06b6d4' },
  ] : [];

  if (user?.role === 'superadmin' && stats) {
    overviewCards.push({ title: 'Total Admins', value: stats.totalAdmins || 0, subtext: 'Active admin accounts', icon: Users, accent: '#ec4899' });
  }

  const revenueCards = stats ? [
    { title: 'Total Leads', value: stats.allLead || 0, subtext: 'All acquired leads', icon: Star, accent: '#3b82f6' },
    { title: 'Total Revenue', value: `₹${(stats.allLeadAmount || 0).toLocaleString()}`, subtext: 'Expected lead value', icon: TrendingUp, accent: '#0ea5e9' },
    { title: 'Converted Leads', value: stats.lead || 0, subtext: 'Successfully closed', icon: Star, accent: '#10b981' },
    { title: 'Converted Revenue', value: `₹${(stats.totalLeadValue || 0).toLocaleString()}`, subtext: 'Aggregate lead value', icon: TrendingUp, accent: '#8b5cf6' },
  ] : [];

  const activityCards = stats ? [
    { title: 'Appointments', value: stats.appointment || 0, subtext: 'Scheduled', icon: Calendar, accent: '#a855f7' },
    { title: 'Call Backs', value: stats.callBack || 0, subtext: 'Follow-up required', icon: PhoneCall, accent: '#06b6d4' },
  ] : [];

  const negativeCards = stats ? [
    { title: 'Invalid / Wrong No.', value: stats.invalid || 0, subtext: 'Bad contact info', icon: AlertCircle, accent: '#f97316' },
    { title: 'Call Not Answered', value: stats.callNotAnswered || 0, subtext: 'Max attempts reached', icon: PhoneOff, accent: '#f59e0b' },
    { title: 'Hung Up', value: stats.hungUp || 0, subtext: 'Max attempts reached', icon: PhoneOff, accent: '#f43f5e' },
    { title: 'Do Not Call', value: stats.doNotCall || 0, subtext: 'Excluded contacts', icon: XCircle, accent: '#64748b' },
    { title: 'Not Interested', value: stats.notInterested || 0, subtext: 'Not interested in offer', icon: XCircle, accent: '#ef4444' },
    { title: 'Language Barrier', value: stats.languageBarrier || 0, subtext: 'Language barrier', icon: PhoneOff, accent: '#3b82f6' },
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
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {user?.role === 'superadmin' && (
            <button
              onClick={handleGlobalWipe}
              className="btn btn-danger"
              style={{
                fontSize: '0.8rem',
                padding: '8px 14px',
              }}
            >
              <Trash2 size={14} /> Global System Wipe
            </button>
          )}

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

          {user?.role === 'admin' && (
            <button
              onClick={() => {
                setReceiverMail(user?.receiverMail || '');
                setShowAdminSettings(true);
              }}
              className="btn btn-primary"
              style={{
                fontSize: '0.8rem',
                padding: '8px 14px',
              }}
            >
              <Settings size={14} /> Settings
            </button>
          )}
        </div>
      </div>

      {/* ── DATE RANGE FILTER BAR ── */}
      {user?.role !== 'agent' && (
        <div className="glass-panel" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '14px 18px', borderRadius: 16, marginBottom: 24, background: 'rgba(255, 255, 255, 0.72)', border: '1px solid rgba(255, 255, 255, 0.85)', flexWrap: 'wrap', boxShadow: '0 8px 30px -10px rgba(0,0,0,0.07)', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Filter size={15} color="var(--primary)" />
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date Range Filter</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button 
                type="button"
                className="btn btn-outline" 
                style={{
                  padding: '4px 12px', fontSize: '0.72rem', borderRadius: 20, height: 28,
                  borderColor: (fromDate === formatDateStr(new Date()) && toDate === formatDateStr(new Date())) ? 'var(--primary)' : 'rgba(0,0,0,0.1)',
                  background: (fromDate === formatDateStr(new Date()) && toDate === formatDateStr(new Date())) ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                  color: (fromDate === formatDateStr(new Date()) && toDate === formatDateStr(new Date())) ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: 700
                }}
                onClick={() => setQuickFilter('today')}
              >
                Today
              </button>
              <button 
                type="button"
                className="btn btn-outline" 
                style={{
                  padding: '4px 12px', fontSize: '0.72rem', borderRadius: 20, height: 28,
                  borderColor: (fromDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 1))) && toDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 1)))) ? 'var(--primary)' : 'rgba(0,0,0,0.1)',
                  background: (fromDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 1))) && toDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 1)))) ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                  color: (fromDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 1))) && toDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 1)))) ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: 700
                }}
                onClick={() => setQuickFilter('yesterday')}
              >
                Yesterday
              </button>
              <button 
                type="button"
                className="btn btn-outline" 
                style={{
                  padding: '4px 12px', fontSize: '0.72rem', borderRadius: 20, height: 28,
                  borderColor: (fromDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 7))) && toDate === formatDateStr(new Date())) ? 'var(--primary)' : 'rgba(0,0,0,0.1)',
                  background: (fromDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 7))) && toDate === formatDateStr(new Date())) ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                  color: (fromDate === formatDateStr(new Date(new Date().setDate(new Date().getDate() - 7))) && toDate === formatDateStr(new Date())) ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: 700
                }}
                onClick={() => setQuickFilter('lastweek')}
              >
                Last Week
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input 
              type="date" 
              className="input-field" 
              style={{ marginBottom: 0, padding: '6px 12px', fontSize: '0.8rem', width: 140, height: 32 }} 
              value={fromDate} 
              onChange={e => setFromDate(e.target.value)} 
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>to</span>
            <input 
              type="date" 
              className="input-field" 
              style={{ marginBottom: 0, padding: '6px 12px', fontSize: '0.8rem', width: 140, height: 32 }} 
              value={toDate} 
              onChange={e => setToDate(e.target.value)} 
            />
            {(fromDate || toDate) && (
              <button 
                className="btn btn-outline" 
                style={{ padding: '6px 12px', fontSize: '0.75rem', height: 32 }} 
                onClick={() => { setFromDate(''); setToDate(''); }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── AGENT CALLS BAR GRAPH ── */}
      {!loading && user?.role !== 'agent' && agentCallsData.length > 0 && (
        <div className="glass-panel" style={{ padding: '24px', borderRadius: 20, marginBottom: 24, background: 'rgba(255, 255, 255, 0.72)', border: '1px solid rgba(255, 255, 255, 0.85)', boxShadow: '0 8px 30px -10px rgba(0,0,0,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <PhoneCall size={14} strokeWidth={2.5} />
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#1f2937', margin: 0 }}>Agent Call Summary</h3>
            </div>
            <span className="badge badge-primary">Real-time</span>
          </div>
          <div style={{ height: 260, width: '100%', marginTop: 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agentCallsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <RechartsTooltip
                  contentStyle={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}
                  itemStyle={{ color: '#fff', fontSize: 13 }}
                  labelStyle={{ color: '#94a3b8', fontSize: 12, fontWeight: 700 }}
                />
                <Bar dataKey="callsCount" name="Calls Done" fill="url(#colorCalls)" radius={[6, 6, 0, 0]} barSize={32} />
                <defs>
                  <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── BREAK TIMER CONTROLS FOR AGENTS ── */}
      {!loading && user?.role === 'agent' && (
        <div className="glass-panel" style={{ padding: '22px', borderRadius: 20, marginBottom: 24, background: 'rgba(255, 255, 255, 0.72)', border: '1px solid rgba(255, 255, 255, 0.85)', boxShadow: '0 8px 30px -10px rgba(0,0,0,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Coffee size={14} strokeWidth={2.5} />
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Break Control Panel</span>
          </div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#1f2937', margin: '0 0 6px 0' }}>Need a Break?</h3>
          <p style={{ fontSize: '0.82rem', color: '#6b7280', margin: '0 0 16px 0', fontWeight: 500 }}>
            Select one of the allocated breaks below. Starting a break locks your screen and pauses the activity tracker.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => handleStartBreak('lunch')}
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, fontWeight: 700, borderColor: '#f59e0b', color: '#d97706' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fef3c7'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Coffee size={15} />
              Lunch Break (30m)
            </button>
            <button
              onClick={() => handleStartBreak('bio')}
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, fontWeight: 700, borderColor: '#10b981', color: '#059669' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#ecfdf5'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Activity size={15} />
              Bio Break (10m)
            </button>
            <button
              onClick={() => handleStartBreak('tea')}
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, fontWeight: 700, borderColor: '#3b82f6', color: '#2563eb' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Clock size={15} />
              Tea Break (15m)
            </button>
          </div>
        </div>
      )}

      {/* ── BREAK TIMER COUNTDOWN OVERLAY ── */}
      {activeBreak && (
        <BreakTimerOverlay activeBreak={activeBreak} onEndBreak={handleEndBreak} />
      )}

      {/* ── PRIMARY KPI SECTION ── */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginBottom: 24 }}>
          {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          <SectionLabel icon={Zap} label="Overview & Operations" accent="var(--primary)" />
          <div className="grid-stats" style={{ marginBottom: 24 }}>
            {overviewCards.map((c, i) => <StatCard key={c.title} {...c} delay={i * 60} />)}
          </div>

          <SectionLabel icon={TrendingUp} label="Leads & Revenue" accent="#0ea5e9" />
          <div className="grid-stats" style={{ marginBottom: 24 }}>
            {revenueCards.map((c, i) => <StatCard key={c.title} {...c} delay={180 + i * 60} />)}
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
                  {['Agent', (user?.role === 'admin' || user?.role === 'superadmin') && 'Team Lead', 'Total', 'Pending', 'Disposed', 'Leads', 'Revenue', 'Appts', 'Progress'].filter(Boolean).map(h => (
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
                    <tr key={i} style={{ 
                        borderBottom: '1px solid rgba(37,99,235,0.05)', 
                        transition: 'background 0.2s',
                        background: q.active === false ? 'rgba(239, 68, 68, 0.08)' : 'transparent'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = q.active === false ? 'rgba(239, 68, 68, 0.12)' : 'rgba(37,99,235,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = q.active === false ? 'rgba(239, 68, 68, 0.08)' : 'transparent'}>
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: '50%',
                             background: q.active === false ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                             color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                             fontSize: '0.75rem', fontWeight: 800, flexShrink: 0
                           }}>
                            {q.agent?.name?.charAt(0)?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.875rem', color: q.active === false ? '#b91c1c' : '#0f172a' }}>{q.agent?.name || 'Unknown'}</div>
                            <div style={{ fontSize: '0.7rem', color: q.active === false ? '#ef4444' : '#94a3b8', fontWeight: 500 }}>{q.active === false ? 'INACTIVE' : 'Agent'}</div>
                          </div>
                        </div>
                      </td>
                      {(user?.role === 'admin' || user?.role === 'superadmin') && (
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

      {showAdminSettings && (
        <div className="modal-overlay">
          <div className="modal-box animate-fade-in" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Admin Settings</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAdminSettings(false)}><X size={18} /></button>
            </div>
            <div style={{ padding: '20px 0 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>Receiver Email for Converted Leads *</label>
                  <input
                    type="text"
                    className="input-field"
                    value={receiverMail}
                    onChange={e => setReceiverMail(e.target.value)}
                    placeholder="admin@example.com, backup@example.com"
                  />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Whenever a lead is successfully converted by an agent under you, an email with the transaction details will be sent to this address. (Separate multiple emails with commas; the first will be the main receiver and the rest will be CC'd).
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <button className="btn btn-outline" onClick={() => setShowAdminSettings(false)} disabled={savingSettings}>Cancel</button>
                <button className="btn btn-primary" onClick={saveAdminSettings} disabled={savingSettings}>
                  {savingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
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
