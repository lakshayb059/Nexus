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
  const [reportType,    setReportType]    = useState('workflow');
  const [loading,       setLoading]       = useState(true);
  const [isExporting,   setIsExporting]   = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const query = selectedAgent ? `?agentId=${selectedAgent}` : '';
      const [statsRes, agentsRes] = await Promise.all([
        api.get(`/contacts/stats${query}`),
        user.role !== 'agent'
          ? api.get(['admin', 'superadmin'].includes(user.role) ? '/users' : '/users/my-agents')
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
      const queryParams = new URLSearchParams({ format, reportType });
      if (selectedAgent) queryParams.append('agentId', selectedAgent);
      
      const res = await api.get(`/reports/download?${queryParams.toString()}`, { responseType: 'blob' });
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

  const chartData = stats ? (reportType === 'workflow' ? [
    { name: 'Pending',      value: stats.pending || 0 },
    { name: 'Leads',        value: stats.lead || 0 },
    { name: 'Appointments', value: stats.appointment || 0 },
    { name: 'No Answer',    value: stats.callNotAnswered || stats.noAnswer || 0 },
    { name: 'Hung Up',      value: stats.hungUp || 0 },
    { name: 'Invalid',      value: stats.invalid || 0 },
    { name: 'Call Back',    value: stats.callBack || 0 },
    { name: 'DNC',          value: stats.doNotCall || 0 },
  ].filter(d => d.value > 0) : [
    { name: 'Leads',        value: stats.lead || 0 },
    { name: 'Appointments', value: stats.appointment || 0 },
    { name: 'Call Backs',   value: stats.callBack || 0 },
  ].filter(d => d.value > 0)) : [];

  const funnelData = stats ? [
    { name: 'Total', value: stats.total || 0 },
    { name: 'Attempted', value: (stats.total - stats.pending) || 0 },
    { name: 'Success', value: (stats.lead + stats.appointment) || 0 },
  ] : [];

  const summaryPills = stats ? (reportType === 'workflow' ? [
    { label: 'Total Contacts',   value: stats.total || 0,       color: 'var(--primary)' },
    { label: 'Pending',          value: stats.pending || 0,     color: 'var(--warning)' },
    { label: 'Processed',        value: (stats.total - stats.pending) || 0, color: 'var(--success)' },
    { label: 'Efficiency',       value: stats.total > 0 ? `${Math.round(((stats.total - stats.pending) / stats.total) * 100)}%` : '0%', color: 'var(--violet)' },
  ] : [
    { label: 'Total Leads',      value: stats.lead || 0,        color: 'var(--success)' },
    { label: 'Appointments',     value: stats.appointment || 0, color: '#8b5cf6' },
    { label: 'Lead Value',       value: `₹${(stats.totalLeadAmount || 0).toLocaleString()}`, color: 'var(--primary)' },
    { label: 'Conversion',       value: (stats.total - stats.pending) > 0 ? `${Math.round(((stats.lead + stats.appointment) / (stats.total - stats.pending)) * 100)}%` : '0%', color: 'var(--cyan)' },
  ]) : [];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 'var(--h1)', fontWeight: 900, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart2 size={20} color="var(--primary)" /> {reportType === 'workflow' ? 'Analytics' : 'Leads'}
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4 }}>Tracking performance and funnel efficiency</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select 
            className="input-field" 
            style={{ marginBottom: 0, minWidth: 140, height: 36, fontSize: '0.8rem' }}
            value={reportType} 
            onChange={e => setReportType(e.target.value)}
          >
            <option value="workflow">Workflow</option>
            <option value="lead">Lead Report</option>
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-outline" onClick={() => handleExport('csv')} disabled={isExporting} style={{ height: 36, padding: '0 12px' }}>
              <Download size={14} /> <span className="hide-mobile">CSV</span>
            </button>
            <button className="btn btn-primary" onClick={() => handleExport('xlsx')} disabled={isExporting} style={{ height: 36, padding: '0 12px' }}>
              <FileSpreadsheet size={14} /> <span className="hide-mobile">Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      {user.role !== 'agent' && (
        <div className="glass-panel" style={{ marginBottom: 20, padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 700 }}>
            <User size={14} /> <span className="hide-mobile">Filter by Agent:</span>
          </div>
          <select className="input-field" style={{ marginBottom: 0, minWidth: 180, flex: 1, maxWidth: 300, height: 34, fontSize: '0.8rem' }}
            value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}>
            <option value="">Full Team Overview</option>
            {agents.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
          {selectedAgent && (
            <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 8px' }} onClick={() => setSelectedAgent('')}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Summary pills */}
      {!loading && stats && (
        <div className="grid-stats" style={{ marginBottom: 20 }}>
          {summaryPills.map(p => (
            <div key={p.label} className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 4, borderTop: `4px solid ${p.color}` }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{p.label}</span>
              <span style={{ fontWeight: 900, fontSize: '1.4rem', color: 'var(--text-primary)', lineHeight: 1 }}>{p.value}</span>
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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No contacts have been disposed for this selection yet.</p>
        </div>
      ) : (
        <div className="grid-2">
          {/* Main Chart Area */}
          <div className="glass-panel" style={{ padding: 'var(--card-p)', minHeight: 450 }}>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
              {reportType === 'workflow' ? 'Disposition Funnel' : 'Success Distribution'}
            </h2>
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%" cy="50%"
                  innerRadius={80} outerRadius={125}
                  paddingAngle={5}
                  dataKey="value"
                  animationBegin={0}
                  animationDuration={1200}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  verticalAlign="bottom" 
                  height={36} 
                  iconType="circle"
                  formatter={(v) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>{v}</span>} 
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-panel" style={{ padding: 'var(--card-p)', minHeight: 450 }}>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 24 }}>
              {reportType === 'workflow' ? 'Workflow Efficiency' : 'Outcome Comparison'}
            </h2>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={reportType === 'workflow' ? funnelData : chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)' }} />
                <Bar 
                  dataKey="value" 
                  radius={[6, 6, 0, 0]} 
                  barSize={40}
                  animationDuration={1500}
                >
                  {(reportType === 'workflow' ? funnelData : chartData).map((_, i) => (
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
