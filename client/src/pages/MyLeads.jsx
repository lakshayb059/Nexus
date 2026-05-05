import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import { Star, TrendingUp, Users, Calendar, Search, PhoneCall, Award, Target, Trash2, X, CheckSquare, Square, RotateCw } from 'lucide-react';
import LeadStatusModal from '../components/LeadStatusModal';

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
  
  // Modal State
  const [modalLead,       setModalLead]       = useState(null);
  const [modalStatus,     setModalStatus]     = useState(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  
  // History Modal State
  const [historyContact, setHistoryContact] = useState(null);
  const [historyData,    setHistoryData]    = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const fetchHistory = async (phone, name) => {
    try {
      setHistoryLoading(true);
      setHistoryContact({ phone, name });
      const res = await api.get(`/leads/history/${phone}`);
      setHistoryData(res.data);
    } catch (err) {
      console.error('Fetch history failed', err);
    } finally {
      setHistoryLoading(false);
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
      await api.delete(`/leads/${id}`);
      fetchData();
      setSelectedIds(prev => prev.filter(i => i !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} selected leads?`)) return;
    try {
      await api.post('/leads/bulk-delete', { ids: selectedIds });
      setSelectedIds([]);
      fetchData();
    } catch (err) {
      alert('Bulk delete failed');
    }
  };

  const handleStatusChange = async (target, newStatus, type = 'contact') => {
    // If it's a special status requiring input, show modal
    if (['Converted', 'Call Back', 'Others'].includes(newStatus)) {
      setModalLead({ ...target, type });
      setModalStatus(newStatus);
      return;
    }

    // Simple status update
    try {
      if (type === 'lead') {
        await api.put(`/leads/${target._id}`, { status: newStatus });
        fetchHistory(historyContact.phone, historyContact.name);
      } else {
        // Main dashboard updates use contactId
        const cid = target.contactId || target._id;
        await api.put(`/contacts/${cid}/status`, { status: newStatus });
      }
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    }
  };

  const handleModalSave = async (formData) => {
    setModalSubmitting(true);
    try {
      if (modalLead.type === 'lead') {
        await api.put(`/leads/${modalLead._id}`, { 
          status: modalStatus, 
          ...formData 
        });
        fetchHistory(historyContact.phone, historyContact.name);
      } else {
        // Main dashboard updates use contactId
        const cid = modalLead.contactId || modalLead._id;
        await api.put(`/contacts/${cid}/status`, { 
          status: modalStatus, 
          ...formData 
        });
      }
      setModalLead(null);
      setModalStatus(null);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    } finally {
      setModalSubmitting(false);
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
            
            const isNegative = lead.status === 'Not Interested' || lead.status === 'DNC/DND';
            const isConverted = lead.status === 'Converted';
            const isLocked = isConverted && lead.transactionId && user?.role !== 'admin';

            return (
              <div key={lead._id} className={`glass-panel lead-list-item ${isSelected ? 'selected' : ''}`} style={{ 
                padding: 'var(--card-p)', 
                borderLeft: isSelected ? '4px solid var(--primary)' : `4px solid ${isConverted ? '#10b981' : isNegative ? '#ef4444' : lead.status === 'Call Back' ? '#06b6d4' : 'var(--border)'}`, 
                position: 'relative',
                opacity: isLocked ? 0.8 : 1
              }}>
                
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
                    <div style={{ 
                      width: 56, 
                      height: 56, 
                      borderRadius: 'var(--r-md)', 
                      background: isConverted ? 'linear-gradient(135deg,#10b981,#059669)' : isNegative ? 'linear-gradient(135deg,#ef4444,#b91c1c)' : 'var(--bg-surface-2)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      color: (isConverted || isNegative) ? '#fff' : 'var(--text-muted)', 
                      flexShrink: 0 
                    }}>
                      <Star size={24} fill={(isConverted || isNegative) ? "white" : "none"} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 6 }}>{name}</h3>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><PhoneCall size={13} /> {phone}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={13} /> {new Date(lead.lastModified || lead.createdAt).toLocaleDateString()}</span>
                        {lead.agentName && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>by {lead.agentName}</span>}
                        {lead.leadsCount > 1 && (
                          <button 
                            onClick={() => fetchHistory(phone, name)}
                            className="badge-link"
                            style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#8b5cf6', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            <TrendingUp size={13} /> {lead.leadsCount} Total Conversions
                          </button>
                        )}
                      </div>
                      
                      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select 
                          className="input-field" 
                          style={{ marginBottom: 0, padding: '4px 10px', fontSize: '0.75rem', height: 32, width: 'auto', minWidth: 140, cursor: isLocked ? 'not-allowed' : 'pointer' }}
                          value={lead.status || ''}
                          disabled={isLocked}
                          title={isLocked ? "This lead is locked and cannot be modified by agents." : ""}
                          onChange={(e) => handleStatusChange(lead, e.target.value, 'contact')}
                        >
                          <option value="">Set Status</option>
                          <option value="Converted">Converted</option>
                          <option value="Not Interested">Not Interested</option>
                          <option value="DNC/DND">DNC/DND</option>
                          <option value="Call Back">Call Back</option>
                          <option value="Others">Others</option>
                        </select>

                        {lead.status === 'Call Back' && lead.callBackDt ? (
                          <span className="badge" style={{ backgroundColor: '#06b6d415', color: '#06b6d4', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Calendar size={12} /> Callback: {new Date(lead.callBackDt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : lead.status === 'Others' && lead.statusDetails ? (
                          <span className="badge" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                            Info: {lead.statusDetails}
                          </span>
                        ) : lead.transactionId ? (
                          <span className="badge" style={{ backgroundColor: '#10b98115', color: '#10b981' }}>UTR: {lead.transactionId}</span>
                        ) : null}
                        {lead.remarks && (
                          <div style={{ width: '100%', fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 8 }}>
                            "{lead.remarks}"
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="lead-actions-col" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end', minWidth: 120 }}>
                    <div className="lead-amount-box" style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Latest Amount</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#10b981' }}>₹{(lead.leadAmount || 0).toLocaleString()}</div>
                      {lead.totalAmount > lead.leadAmount && (
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#8b5cf6', marginTop: 4 }}>
                          Total: ₹{lead.totalAmount.toLocaleString()}
                        </div>
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', gap: 8 }}>
                      {phone !== 'N/A' && (
                        <a 
                          href={`tel:${phone}`} 
                          className="btn btn-primary btn-icon" 
                          style={{ 
                            background: 'linear-gradient(135deg, #10b981, #059669)', 
                            border: 'none',
                            width: 42,
                            height: 42,
                            borderRadius: '12px',
                            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                          }}
                          title={`Call ${name}`}
                        >
                          <PhoneCall size={18} fill="white" />
                        </a>
                      )}
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
          transition: transform 0.2s, box-shadow 0.2s, background-color 0.2s;
        }
        .lead-list-item:hover {
          transform: translateX(4px);
          box-shadow: var(--shadow-lg);
        }
        .lead-list-item.selected {
          background-color: var(--primary-light-alpha);
        }
        .badge-link {
          transition: transform 0.2s;
        }
        .badge-link:hover {
          transform: scale(1.05);
          text-decoration: underline;
        }
      `}</style>

      {modalLead && (
        <LeadStatusModal 
          lead={modalLead} 
          newStatus={modalStatus} 
          onClose={() => { setModalLead(null); setModalStatus(null); }}
          onSave={handleModalSave}
          submitting={modalSubmitting}
        />
      )}

      {/* History Modal */}
      {historyContact && (
        <div className="status-modal-overlay animate-fade-in">
          <div className="status-modal-content animate-scale-up" style={{ maxWidth: 600 }}>
            <div className="status-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="status-icon-wrapper" style={{ background: '#8b5cf615', color: '#8b5cf6' }}>
                  <TrendingUp size={24} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900 }}>Conversion History</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{historyContact.name} ({historyContact.phone})</p>
                </div>
              </div>
              <button onClick={() => setHistoryContact(null)} className="status-modal-close">
                <X size={20} />
              </button>
            </div>
            
            <div className="status-modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {historyLoading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}><RotateCw className="animate-spin" size={32} /></div>
              ) : historyData.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No historical records found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {historyData.map((h, i) => (
                    <div key={h._id} style={{ 
                      padding: 16, 
                      borderRadius: 16, 
                      background: 'var(--bg-surface-2)', 
                      borderLeft: `4px solid ${h.status === 'Converted' ? '#10b981' : h.status === 'Not Interested' ? '#ef4444' : 'var(--border)'}` 
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <select 
                          className="input-field" 
                          style={{ marginBottom: 0, padding: '2px 8px', fontSize: '0.7rem', height: 28, width: 'auto', minWidth: 120 }}
                          value={h.status || ''}
                          disabled={h.status === 'Converted' && h.transactionId && user?.role !== 'admin'}
                          title={h.status === 'Converted' && h.transactionId && user?.role !== 'admin' ? "Locked conversions cannot be modified by agents." : ""}
                          onChange={(e) => handleStatusChange(h, e.target.value, 'lead')}
                        >
                          <option value="">Set Status</option>
                          <option value="Converted">Converted</option>
                          <option value="Not Interested">Not Interested</option>
                          <option value="DNC/DND">DNC/DND</option>
                          <option value="Call Back">Call Back</option>
                          <option value="Others">Others</option>
                        </select>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(h.createdAt).toLocaleString()}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>₹{(h.leadAmount || 0).toLocaleString()}</div>
                          {h.agentName && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>Handled by: {h.agentName}</div>}
                          
                          {/* Specific Details - Conditional based on current record status */}
                          {h.status === 'Call Back' && h.callBackDt && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--cyan)', fontWeight: 700, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Calendar size={12} /> Callback: {new Date(h.callBackDt).toLocaleString()}
                            </div>
                          )}
                          {h.status === 'Appointment' && h.appointmentDt && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--violet)', fontWeight: 700, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Calendar size={12} /> Appointment: {new Date(h.appointmentDt).toLocaleString()}
                            </div>
                          )}
                        </div>
                        {h.status === 'Converted' && h.transactionId && (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>UTR / Trans ID</div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--success)' }}>{h.transactionId}</div>
                          </div>
                        )}
                      </div>
                      {h.remarks && (
                        <div style={{ marginTop: 12, fontSize: '0.8rem', fontStyle: 'italic', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.03)', padding: '8px 12px', borderRadius: 8 }}>
                          "{h.remarks}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="status-modal-footer">
              <button onClick={() => setHistoryContact(null)} className="btn btn-primary" style={{ width: '100%' }}>Close History</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyLeads;
