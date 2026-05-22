import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import {
  Users, PhoneCall, Star, Calendar, Clock,
  TrendingUp, Database, RefreshCw, PhoneOff,
  AlertCircle, Activity, Trash2, XCircle, Shield
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area
} from 'recharts';
import './SuperAdminDashboard.css';

/* ─────────────────────────────────────────
   SUPER SKELETON
───────────────────────────────────────── */
const SuperSkeleton = () => (
  <div className="sa-glass-card sa-skeleton">
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 50, height: 50, borderRadius: 16, background: 'rgba(255,255,255,0.2)' }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 12, width: '40%', background: 'rgba(255,255,255,0.2)', borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 24, width: '60%', background: 'rgba(255,255,255,0.2)', borderRadius: 4 }} />
      </div>
    </div>
  </div>
);

/* ─────────────────────────────────────────
   MODERN STAT CARD
───────────────────────────────────────── */
const SuperStatCard = ({ title, value, subtext, icon: Icon, accent, delay = 0, glow = false }) => (
  <div className={`sa-glass-card sa-slide-up ${glow ? 'sa-glow' : ''}`} style={{ animationDelay: `${delay}ms`, '--card-accent': accent }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 2 }}>
      <div>
        <div className="sa-card-title">{title}</div>
        <div className="sa-card-value">{value}</div>
        <div className="sa-card-subtext">{subtext}</div>
      </div>
      <div className="sa-card-icon-wrapper" style={{ background: `${accent}15`, color: accent }}>
        <Icon size={24} strokeWidth={2} />
      </div>
    </div>
    <div className="sa-card-bg-blob" style={{ background: accent }} />
  </div>
);

/* ─────────────────────────────────────────
   SUPERADMIN DASHBOARD
───────────────────────────────────────── */
const SuperAdminDashboard = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [stats, setStats] = useState(null);
  const [adminStats, setAdminStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [statsRes, adminStatsRes] = await Promise.all([
        api.get('/contacts/stats'),
        api.get('/contacts/admin-stats')
      ]);
      setStats({ ...statsRes.data, totalLeadValue: statsRes.data.totalLeadAmount || 0 });
      setAdminStats(adminStatsRes.data || []);
    } catch (err) {
      console.error('Superadmin Dashboard fetch failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (!socket) return;
    const events = ['contacts_updated', 'contact_disposed', 'lead_disposed', 'dashboard_update', 'batch_uploaded', 'users_updated', 'appointment_scheduled', 'appointment_cancelled'];
    const handler = () => fetchData(true);
    events.forEach(e => socket.on(e, handler));
    return () => events.forEach(e => socket.off(e, handler));
  }, [socket, user]);

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

  const overviewCards = stats ? [
    { title: 'Total Contacts', value: stats.total || 0, subtext: 'In system', icon: Users, accent: '#6366f1' },
    { title: 'Pending Queue', value: stats.pending || 0, subtext: 'Awaiting disposition', icon: Clock, accent: '#f59e0b' },
    { title: 'Total Admins', value: stats.totalAdmins || 0, subtext: 'Active admin accounts', icon: Shield, accent: '#ec4899' },
  ] : [];

  const revenueCards = stats ? [
    { title: 'Total Leads', value: stats.allLead || 0, subtext: 'All acquired leads', icon: Star, accent: '#3b82f6' },
    { title: 'Total Revenue', value: `₹${(stats.allLeadAmount || 0).toLocaleString()}`, subtext: 'Expected lead value', icon: TrendingUp, accent: '#0ea5e9' },
    { title: 'Converted Leads', value: stats.lead || 0, subtext: 'Successfully closed', icon: Star, accent: '#10b981', glow: true },
    { title: 'Converted Revenue', value: `₹${(stats.totalLeadValue || 0).toLocaleString()}`, subtext: 'Aggregate lead value', icon: TrendingUp, accent: '#8b5cf6', glow: true },
  ] : [];

  // Data for chart
  const chartData = adminStats.map(a => ({
    name: a.name,
    Leads: a.leads,
    Revenue: a.totalLeadAmount
  }));

  return (
    <div className="sa-dashboard-container">
      {/* ── HEADER ── */}
      <div className="sa-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div className="sa-icon-box">
              <Activity size={20} color="#fff" strokeWidth={2.5} />
            </div>
            <h1 className="sa-title">Command Center</h1>
          </div>
          <p className="sa-subtitle">
            Welcome back, <strong>{user?.name}</strong>. Here's what's happening today.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={handleGlobalWipe} className="sa-btn sa-btn-danger">
            <Trash2 size={16} /> Wipe System
          </button>
          <button onClick={() => fetchData(true)} disabled={refreshing || loading} className="sa-btn sa-btn-primary">
            <RefreshCw size={16} className={refreshing ? 'sa-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="sa-bento-grid">
          {Array.from({ length: 7 }).map((_, i) => <SuperSkeleton key={i} />)}
        </div>
      ) : (
        <div className="sa-main-content">
          {/* TOP CARDS */}
          <div className="sa-section-title">Platform Overview</div>
          <div className="sa-grid-3">
            {overviewCards.map((c, i) => <SuperStatCard key={i} {...c} delay={i * 50} />)}
          </div>

          <div className="sa-section-title" style={{ marginTop: 32 }}>Revenue & Conversions</div>
          <div className="sa-grid-4">
            {revenueCards.map((c, i) => <SuperStatCard key={i} {...c} delay={150 + i * 50} />)}
          </div>

          {/* CHARTS & TABLES */}
          <div className="sa-bento-layout" style={{ marginTop: 32 }}>
            
            {/* Admin Performance Chart */}
            <div className="sa-glass-card sa-chart-container sa-slide-up" style={{ animationDelay: '350ms' }}>
              <div className="sa-card-header">
                <h3>Admin Revenue Generation</h3>
                <div className="sa-badge">Real-time</div>
              </div>
              <div style={{ height: 300, width: '100%', marginTop: 20 }}>
                {adminStats.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="left" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <RechartsTooltip 
                        contentStyle={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}
                        itemStyle={{ color: '#fff', fontSize: 14 }}
                      />
                      <Bar yAxisId="left" dataKey="Revenue" fill="url(#colorRevenue)" radius={[6, 6, 0, 0]} barSize={40} />
                      <Bar yAxisId="right" dataKey="Leads" fill="url(#colorLeads)" radius={[6, 6, 0, 0]} barSize={40} />
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={1}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.8}/>
                        </linearGradient>
                        <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={1}/>
                          <stop offset="95%" stopColor="#34d399" stopOpacity={0.8}/>
                        </linearGradient>
                      </defs>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="sa-empty-state">No admin data available</div>
                )}
              </div>
            </div>

            {/* Detailed Admin Table */}
            <div className="sa-glass-card sa-table-container sa-slide-up" style={{ animationDelay: '400ms' }}>
              <div className="sa-card-header" style={{ marginBottom: 16 }}>
                <h3>Admin Breakdown</h3>
              </div>
              <div className="sa-table-wrapper">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Admin Name</th>
                      <th>Conv. Leads</th>
                      <th>Appointments</th>
                      <th>Callbacks</th>
                      <th style={{ textAlign: 'right' }}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminStats.length > 0 ? adminStats.map((a, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</td>
                        <td><div className="sa-stat-badge bg-emerald">{a.leads}</div></td>
                        <td><div className="sa-stat-badge bg-purple">{a.appointments}</div></td>
                        <td><div className="sa-stat-badge bg-blue">{a.callbacks}</div></td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>₹{a.totalLeadAmount?.toLocaleString() || 0}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan="5" className="sa-empty-state">No records found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminDashboard;
