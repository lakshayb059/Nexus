import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import { Star, TrendingUp, Users, Calendar, Search, PhoneCall, Award, Target } from 'lucide-react';

const MyLeads = () => {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const [leads,      setLeads]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [stats,      setStats]      = useState({ totalLeads: 0, totalAmount: 0 });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [leadsRes, statsRes] = await Promise.all([
        api.get('/leads/my-leads'),
        api.get('/leads/stats'),
      ]);
      setLeads(leadsRes.data);
      setStats(statsRes.data);
    } catch (err) {
      console.error('Fetch leads failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (!socket) return;
    socket.on('contact_disposed', fetchData);
    socket.on('dashboard_update', fetchData);
    return () => {
      socket.off('contact_disposed', fetchData);
      socket.off('dashboard_update', fetchData);
    };
  }, [socket]);

  const filtered = leads.filter(l => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return Object.values(l.fields || {}).some(v => String(v).toLowerCase().includes(q)) ||
           (l.agentName && l.agentName.toLowerCase().includes(q));
  });

  const todayAmount = leads
    .filter(l => new Date(l.lastModified).toDateString() === new Date().toDateString())
    .reduce((s, l) => s + (l.leadAmount || 0), 0);

  const avgValue = stats.totalLeads > 0
    ? Math.round(stats.totalAmount / stats.totalLeads)
    : 0;

  const kpiCards = [
    { label: 'Total Revenue', value: `₹${stats.totalAmount.toLocaleString()}`, sub: 'Gross converted amount',   icon: TrendingUp, accent: '#10b981', gradient: 'linear-gradient(135deg,#10b981,#059669)', dark: true },
    { label: 'Total Leads',   value: stats.totalLeads,                          sub: 'Converted clients',        icon: Users,      accent: 'var(--primary)' },
    { label: 'Avg Lead Value',value: `₹${avgValue.toLocaleString()}`,           sub: 'Average per conversion',   icon: Target,     accent: '#8b5cf6' },
    { label: "Today's Revenue",value: `₹${todayAmount.toLocaleString()}`,       sub: 'Lead amount today',        icon: Award,      accent: '#f59e0b' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>
            <Star size={24} fill="currentColor" style={{ color: '#10b981' }} /> My Leads
          </h1>
          <p className="page-subtitle">Tracking your converted sales and revenue performance</p>
        </div>
        <span className="badge badge-success" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
          {filtered.length} Converted Leads
        </span>
      </div>

      {/* KPI Cards */}
      <div className="grid-stats" style={{ marginBottom: 'var(--gap)' }}>
        {kpiCards.map((c, i) => {
          const Icon = c.icon;
          return (
            <div
              key={i}
              className="glass-panel"
              style={{
                padding: 'var(--card-p)',
                background: c.gradient || undefined,
                border: c.gradient ? 'none' : undefined,
                boxShadow: c.gradient ? '0 8px 24px rgba(16,185,129,0.2)' : undefined,
                position: 'relative', overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: c.dark ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)' }}>
                  {c.label}
                </span>
                <div style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', background: c.dark ? 'rgba(255,255,255,0.15)' : `${c.accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.dark ? '#fff' : c.accent }}>
                  <Icon size={17} />
                </div>
              </div>
              <div style={{ fontSize: 'clamp(1.5rem,4vw,2rem)', fontWeight: 900, color: c.dark ? '#fff' : 'var(--text-primary)', marginBottom: 6, lineHeight: 1 }}>{c.value}</div>
              <div style={{ fontSize: '0.75rem', color: c.dark ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>{c.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="glass-panel" style={{ marginBottom: 'var(--gap)', padding: '12px 18px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" className="input-field" placeholder="Search leads by name, phone…" style={{ paddingLeft: 42, marginBottom: 0 }}
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
      </div>

      {/* Lead list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-panel" style={{ padding: 'var(--card-p)' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div className="skeleton" style={{ width: 64, height: 64, borderRadius: 'var(--r-md)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 16, width: '40%', marginBottom: 10 }} />
                  <div className="skeleton" style={{ height: 12, width: '60%' }} />
                </div>
                <div className="skeleton" style={{ width: 120, height: 40, borderRadius: 'var(--r-md)' }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel" style={{ padding: '80px 40px', textAlign: 'center' }}>
          <Star size={64} style={{ opacity: 0.08, margin: '0 auto 20px', display: 'block' }} />
          <h3 style={{ marginBottom: 8 }}>No leads found</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>You haven't converted any leads yet. Keep calling!</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filtered.map(lead => {
            const fields = lead.fields || {};
            const name   = fields.Name || fields.name || 'Unknown';
            const phone  = fields.Phone || fields.phone || fields.Mobile || 'N/A';
            return (
              <div key={lead._id} className="glass-panel lead-list-item" style={{ padding: 'var(--card-p)', borderLeft: '4px solid #10b981' }}>
                <div className="lead-list-inner">
                  <div style={{ display: 'flex', gap: 18, alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: 'var(--r-md)',
                      background: 'linear-gradient(135deg,#10b981,#059669)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', flexShrink: 0,
                      boxShadow: '0 4px 12px rgba(16,185,129,0.3)',
                    }}>
                      <Star size={24} fill="white" />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#10b981', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</h3>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><PhoneCall size={13} /> {phone}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={13} /> {new Date(lead.lastModified).toLocaleDateString()}</span>
                        {lead.agentName && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>by {lead.agentName}</span>}
                      </div>
                      
                      {/* Status Editor */}
                      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', minWidth: 140 }}>
                          <select 
                            className="input-field" 
                            style={{ marginBottom: 0, padding: '4px 10px', fontSize: '0.75rem', height: 32 }}
                            value={lead.status || ''}
                            onChange={async (e) => {
                              const newStatus = e.target.value;
                              try {
                                await api.put(`/contacts/${lead._id}/status`, { status: newStatus });
                                fetchData();
                              } catch(err) { alert('Failed to update status'); }
                            }}
                          >
                            <option value="">Set Status</option>
                            <option value="Converted">Converted</option>
                            <option value="Not Interested">Not Interested</option>
                            <option value="DNC/DND">DNC/DND</option>
                            <option value="Call Back">Call Back</option>
                            <option value="Others">Others</option>
                          </select>
                        </div>
                        
                        {lead.status === 'Others' && (
                          <input 
                            type="text" 
                            className="input-field" 
                            placeholder="Specify other status…" 
                            style={{ marginBottom: 0, padding: '4px 10px', fontSize: '0.75rem', height: 32, flex: 1, minWidth: 150 }}
                            defaultValue={lead.statusDetails || ''}
                            onBlur={async (e) => {
                              try {
                                await api.put(`/contacts/${lead._id}/status`, { status: 'Others', statusDetails: e.target.value });
                                fetchData();
                              } catch(err) {}
                            }}
                          />
                        )}
                        
                        {lead.status === 'Call Back' && (
                          <input 
                            type="datetime-local" 
                            className="input-field" 
                            style={{ marginBottom: 0, padding: '4px 10px', fontSize: '0.75rem', height: 32, width: 'auto' }}
                            defaultValue={lead.callBackDt ? new Date(lead.callBackDt).toISOString().slice(0, 16) : ''}
                            onChange={async (e) => {
                              try {
                                await api.put(`/contacts/${lead._id}/status`, { status: 'Call Back', callBackDt: e.target.value });
                                fetchData();
                              } catch(err) {}
                            }}
                          />
                        )}
                      </div>

                      {lead.remarks && (
                        <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          "{lead.remarks.substring(0, 80)}{lead.remarks.length > 80 ? '…' : ''}"
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="lead-amount-box">
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#10b981', marginBottom: 4 }}>Lead Amount</div>
                    <div style={{ fontSize: 'clamp(1.4rem,3vw,1.9rem)', fontWeight: 900, color: '#10b981', lineHeight: 1 }}>
                      ₹{(lead.leadAmount || 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .lead-list-item {
          transition: transform var(--t-base), box-shadow var(--t-base);
          background: linear-gradient(135deg, rgba(16,185,129,0.04) 0%, transparent 100%);
        }
        .lead-list-item:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(0,0,0,0.35); }
        .lead-list-inner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
        }
        .lead-amount-box { text-align: right; min-width: 140px; flex-shrink: 0; }
        @media (max-width: 640px) {
          .lead-list-inner { flex-direction: column; align-items: stretch; }
          .lead-amount-box { text-align: left; border-top: 1px solid var(--border); padding-top: 14px; }
        }
      `}</style>
    </div>
  );
};

export default MyLeads;
