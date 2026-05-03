import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { BarChart2, Download, FileSpreadsheet, User, Filter } from 'lucide-react';

const PALETTE = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#8b5cf6', '#06b6d4'];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      padding: '10px 14px',
      fontSize: '0.8rem',
    }}>
      <strong style={{ color: 'var(--text-primary)' }}>{label || payload[0]?.name}</strong>
      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>Count: <strong style={{ color: 'var(--primary)' }}>{payload[0]?.value}</strong></div>
    </div>
  );
};

const Reports = () => {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const [stats,         setStats]         = useState(null);
  const [agents,        setAgents]        = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [loading,       setLoading]       = useState(true);
  const [isExporting,   setIsExporting]   = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const query = selectedAgent ? `?agentId=${selectedAgent}` : '';
      const [statsRes, agentsRes] = await Promise.all([
        api.get(`/contacts/stats${query}`),
        user.role !== 'agent'
          ? api.get(user.role === 'admin' ? '/users' : '/users/my-agents')
          : Promise.resolve({ data: [] }),
      ]);
      setStats(statsRes.data);
      if (agentsRes.data) setAgents(agentsRes.data.filter(u => u.role === 'agent'));
    } catch (err) {
      console.error('Reports fetch failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (!socket) return;
    const events = ['contacts_updated', 'batch_uploaded', 'users_updated'];
    events.forEach(e => socket.on(e, fetchData));
    return () => events.forEach(e => socket.off(e, fetchData));
  }, [selectedAgent, socket]);

  const handleExport = async (format) => {
    setIsExporting(true);
    try {
      const q = selectedAgent ? `&agentId=${selectedAgent}` : '';
      const res = await api.get(`/reports/download?format=${format}${q}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', `crm_report_${new Date().toISOString().split('T')[0]}.${format}`);
      document.body.appendChild(a); a.click(); a.remove();
    } catch {
      alert('Failed to export report');
    } finally {
      setIsExporting(false);
    }
  };

  const chartData = stats ? [
    { name: 'Pending',      value: stats.pending || 0 },
    { name: 'Leads',        value: stats.lead || 0 },
    { name: 'Appointments', value: stats.appointment || 0 },
    { name: 'No Answer',    value: stats.callNotAnswered || 0 },
    { name: 'Invalid',      value: stats.invalid || 0 },
    { name: 'Call Back',    value: stats.callBack || 0 },
  ].filter(d => d.value > 0) : [];

  const summaryPills = stats ? [
    { label: 'Total',        value: stats.total || 0,       color: 'var(--primary)' },
    { label: 'Leads',        value: stats.lead || 0,        color: 'var(--success)' },
    { label: 'Appointments', value: stats.appointment || 0, color: '#8b5cf6' },
    { label: 'Pending',      value: stats.pending || 0,     color: 'var(--warning)' },
  ] : [];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>
            <BarChart2 size={24} style={{ color: 'var(--primary)' }} /> Reports &amp; Export
          </h1>
          <p className="page-subtitle">View analytics and export contact data</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => handleExport('csv')} disabled={isExporting}>
            <Download size={15} /> <span className="hide-mobile">{isExporting ? 'Exporting…' : 'CSV'}</span>
          </button>
          <button className="btn btn-primary" onClick={() => handleExport('xlsx')} disabled={isExporting}>
            <FileSpreadsheet size={15} /> <span className="hide-mobile">{isExporting ? 'Exporting…' : 'Excel'}</span>
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {user.role !== 'agent' && (
        <div className="glass-panel" style={{ marginBottom: 'var(--gap)', padding: '12px 18px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Filter size={16} style={{ color: 'var(--text-muted)' }} />
          <select className="input-field" style={{ marginBottom: 0, minWidth: 200, flex: 1, maxWidth: 320 }}
            value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}>
            <option value="">All Agents</option>
            {agents.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
          {selectedAgent && (
            <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setSelectedAgent('')}>
              Clear Filter
            </button>
          )}
        </div>
      )}

      {/* Summary pills */}
      {!loading && stats && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 'var(--gap)', flexWrap: 'wrap' }}>
          {summaryPills.map(p => (
            <div key={p.label} className="glass-panel" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 140px' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{p.label}</span>
              <span style={{ fontWeight: 800, fontSize: '1.1rem', marginLeft: 'auto' }}>{p.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {loading ? (
        <div className="grid-2">
          {[0, 1].map(i => (
            <div key={i} className="glass-panel" style={{ height: 380, padding: 'var(--card-p)' }}>
              <div className="skeleton" style={{ height: 14, width: '40%', marginBottom: 20 }} />
              <div className="skeleton" style={{ height: 300 }} />
            </div>
          ))}
        </div>
      ) : chartData.length === 0 ? (
        <div className="glass-panel" style={{ padding: '80px 40px', textAlign: 'center' }}>
          <BarChart2 size={64} style={{ opacity: 0.08, margin: '0 auto 20px', display: 'block' }} />
          <h3 style={{ marginBottom: 8 }}>No data to display</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No contacts have been disposed yet.</p>
        </div>
      ) : (
        <div className="grid-2">
          {/* Pie chart */}
          <div className="glass-panel" style={{ padding: 'var(--card-p)', height: 400 }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Disposition Distribution
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%" cy="45%"
                  innerRadius={70} outerRadius={110}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(v) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Bar chart */}
          <div className="glass-panel" style={{ padding: 'var(--card-p)', height: 400 }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Performance Overview
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, left: 10, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" width={90}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
