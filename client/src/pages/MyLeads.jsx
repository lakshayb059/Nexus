import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import { Star, TrendingUp, Users, Calendar, Search, PhoneCall, Award, Target, Trash2, X, CheckSquare, Square } from 'lucide-react';

const MyLeads = () => {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const [leads,      setLeads]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [searchTerm,   setSearchTerm]   = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats,        setStats]        = useState({ totalLeads: 0, totalAmount: 0 });
  const [selectedIds,  setSelectedIds]  = useState([]);

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
    socket.on('contacts_updated', fetchData);
    return () => {
      socket.off('contact_disposed', fetchData);
      socket.off('dashboard_update', fetchData);
      socket.off('contacts_updated', fetchData);
    };
  }, [socket]);

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this lead? This will remove all associated data.')) return;
    try {
      await api.delete(`/contacts/${id}`);
      fetchData();
      setSelectedIds(prev => prev.filter(i => i !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} selected leads?`)) return;
    try {
      await api.post('/contacts/bulk-delete', { ids: selectedIds });
      setSelectedIds([]);
      fetchData();
    } catch (err) {
      alert('Bulk delete failed');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(l => l._id));
    }
  };

  const filtered = leads.filter(l => {
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const match = Object.values(l.fields || {}).some(v => String(v).toLowerCase().includes(q)) ||
                    (l.agentName && l.agentName.toLowerCase().includes(q));
      if (!match) return false;
    }
    if (sourceFilter === 'created' && l.batchId) return false;
    if (sourceFilter === 'uploaded' && !l.batchId) return false;
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="animate-fade-in">
      <div className="page-header" style={{ marginBottom: 30 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Award size={32} style={{ color: '#10b981' }} /> My Leads
          </h1>
          <p className="page-subtitle">Track and manage your successful conversions</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {user?.role === 'admin' && filtered.length > 0 && (
            <>
              <button className="btn btn-outline" onClick={toggleSelectAll} style={{ fontSize: '0.8rem', padding: '8px 16px' }}>
                {selectedIds.length === filtered.length ? <CheckSquare size={16} /> : <Square size={16} />}
                {selectedIds.length === filtered.length ? 'Deselect All' : 'Select All'}
              </button>
              {selectedIds.length > 0 && (
                <button className="btn btn-danger" onClick={handleBulkDelete} style={{ boxShadow: '0 4px 12px rgba(239,68,68,0.2)' }}>
                  <Trash2 size={16} /> Delete Selected ({selectedIds.length})
                </button>
              )}
            </>
          )}
          <div className="badge badge-primary" style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
            {filtered.length} Leads Found
          </div>
        </div>
      </div>

      <div className="grid-stats" style={{ marginBottom: 'var(--gap)' }}>
        <div className="glass-panel" style={{ padding: 'var(--card-p)', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ padding: 14, background: '#10b98118', color: '#10b981', borderRadius: 'var(--r-md)' }}><Target size={24} /></div>
          <div><div style={{ fontSize: '1.8rem', fontWeight: 900 }}>{stats.totalLeads}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>Total Leads</div></div>
        </div>
        <div className="glass-panel" style={{ padding: 'var(--card-p)', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ padding: 14, background: '#8b5cf618', color: '#8b5cf6', borderRadius: 'var(--r-md)' }}><TrendingUp size={24} /></div>
          <div><div style={{ fontSize: '1.8rem', fontWeight: 900 }}>₹{stats.totalAmount.toLocaleString()}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>Total Revenue</div></div>
        </div>
      </div>

      <div className="glass-panel" style={{ marginBottom: 'var(--gap)', padding: '12px 18px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" className="input-field" placeholder="Search leads by name, phone…" style={{ paddingLeft: 42, marginBottom: 0 }} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        
        <select className="input-field" style={{ width: 'auto', minWidth: 160, marginBottom: 0 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="Converted">Converted</option>
          <option value="Not Interested">Not Interested</option>
          <option value="DNC/DND">DNC/DND</option>
          <option value="Call Back">Call Back</option>
          <option value="Others">Others</option>
        </select>

        <select className="input-field" style={{ width: 'auto', minWidth: 160, marginBottom: 0 }} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
          <option value="all">All Sources</option>
          <option value="created">Created by Agent</option>
          <option value="uploaded">Uploaded Directly</option>
        </select>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : filtered.length === 0 ? (
        <div className="glass-panel" style={{ padding: '80px 40px', textAlign: 'center' }}>
          <Star size={64} style={{ opacity: 0.08, margin: '0 auto 20px', display: 'block' }} />
          <h3>No matching leads found</h3>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filtered.map(lead => {
            const fields = lead.fields || {};
            const name = fields.Name || fields.name || 'Unknown';
            const phone = fields.Phone || fields.phone || fields.Mobile || 'N/A';
            const isSelected = selectedIds.includes(lead._id);

            return (
              <div key={lead._id} className={`glass-panel lead-list-item ${isSelected ? 'selected' : ''}`} style={{ padding: 'var(--card-p)', borderLeft: isSelected ? '4px solid var(--primary)' : `4px solid ${lead.status === 'Converted' ? '#10b981' : lead.status === 'Call Back' ? '#06b6d4' : 'var(--border)'}`, position: 'relative' }}>
                
                {user?.role === 'admin' && (
                  <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
                    <input 
                      type="checkbox" 
                      checked={isSelected} 
                      onChange={() => toggleSelect(lead._id)} 
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--primary)' }} 
                    />
                  </div>
                )}

                {user?.role === 'admin' && (
                  <button 
                    className="btn btn-ghost btn-icon" 
                    onClick={() => handleDelete(lead._id)}
                    style={{ position: 'absolute', top: 12, right: 12, color: 'var(--danger)' }}
                    title="Delete Lead"
                  >
                    <Trash2 size={16} />
                  </button>
                )}

                <div className="lead-list-inner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, paddingLeft: user?.role === 'admin' ? 32 : 0 }}>
                  <div style={{ display: 'flex', gap: 18, alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <div style={{ width: 56, height: 56, borderRadius: 'var(--r-md)', background: lead.status === 'Converted' ? 'linear-gradient(135deg,#10b981,#059669)' : 'var(--bg-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: lead.status === 'Converted' ? '#fff' : 'var(--text-muted)', flexShrink: 0 }}>
                      <Star size={24} fill={lead.status === 'Converted' ? "white" : "none"} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 6 }}>{name}</h3>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><PhoneCall size={13} /> {phone}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={13} /> {new Date(lead.lastModified).toLocaleDateString()}</span>
                        {lead.agentName && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>by {lead.agentName}</span>}
                      </div>
                      
                      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select 
                          className="input-field" 
                          style={{ marginBottom: 0, padding: '4px 10px', fontSize: '0.75rem', height: 32, width: 'auto', minWidth: 140 }}
                          value={lead.status || ''}
                          onChange={async (e) => {
                            const newStatus = e.target.value;
                            let transactionId = lead.transactionId;
                            if (newStatus === 'Converted') {
                              const tid = window.prompt('Transaction ID:', transactionId || '');
                              if (!tid) return;
                              transactionId = tid;
                            }
                            await api.put(`/contacts/${lead._id}/status`, { status: newStatus, transactionId });
                            fetchData();
                          }}
                        >
                          <option value="">Set Status</option>
                          <option value="Converted">Converted</option>
                          <option value="Not Interested">Not Interested</option>
                          <option value="DNC/DND">DNC/DND</option>
                          <option value="Call Back">Call Back</option>
                          <option value="Others">Others</option>
                        </select>

                        {lead.transactionId && (
                          <span className="badge" style={{ backgroundColor: '#10b98115', color: '#10b981' }}>UTR: {lead.transactionId}</span>
                        )}
                        {lead.status === 'Others' && lead.statusDetails && (
                          <span className="badge" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>{lead.statusDetails}</span>
                        )}
                        {lead.remarks && (
                          <div style={{ width: '100%', fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 8 }}>
                            "{lead.remarks}"
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="lead-amount-box" style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Lead Amount</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#10b981' }}>₹{(lead.leadAmount || 0).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      <style>{`
        .lead-list-item {
          transition: transform 0.2s, box-shadow 0.2s, background-color 0.2s;
        }
        .lead-list-item:hover {
          transform: translateX(4px);
          box-shadow: var(--shadow-lg);
        }
        .lead-list-item.selected {
          background-color: var(--primary-light-alpha);
        }
      `}</style>
    </div>
  );
};

export default MyLeads;
