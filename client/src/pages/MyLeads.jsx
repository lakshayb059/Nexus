import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import { Star, TrendingUp, Users, Calendar, Search, PhoneCall, Award, Target, Trash2, X, CheckSquare, Square, RotateCw } from 'lucide-react';
import LeadStatusModal from '../components/LeadStatusModal';
import CallActionModal from '../components/CallActionModal';

const MyLeads = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats, setStats] = useState({ totalLeads: 0, totalAmount: 0 });
  const [selectedIds, setSelectedIds] = useState([]);

  // Modal State
  const [modalLead, setModalLead] = useState(null);
  const [modalStatus, setModalStatus] = useState(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  
  // Call Action Modal State
  const [callActionLead, setCallActionLead] = useState(null);

  // History Modal State
  const [historyContact, setHistoryContact] = useState(null);
  const [historyData, setHistoryData] = useState([]);
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
      const cid = modalLead.contactId || modalLead._id;

      if (modalStatus === 'Call Back') {
        const checkRes = await api.get(`/contacts/${cid}/check-callback`);
        if (checkRes.data.exists) {
          const existing = checkRes.data.callback;
          const choice = window.confirm(
            `A callback already exists for this contact scheduled for ${new Date(existing.callBackDt).toLocaleString()}.\n\n` +
            `Click OK to EDIT the existing callback.\n` +
            `Click CANCEL to CREATE A NEW separate callback record.`
          );

          if (choice) {
            await api.put(`/leads/callbacks/${existing._id}`, {
              callBackDt: formData.callBackDt,
              remarks: formData.remarks || `[Status update to Call Back]`
            });
            alert('Existing callback updated successfully!');
            setModalLead(null);
            setModalStatus(null);
            fetchData();
            return;
          }
        }
      }

      if (modalLead.type === 'lead') {
        await api.put(`/leads/${modalLead._id}`, {
          status: modalStatus,
          ...formData
        });
        if (historyContact) fetchHistory(historyContact.phone, historyContact.name);
      } else {
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

  const handleCallActionSubmit = async (payload) => {
    try {
      const cid = callActionLead.contactId || callActionLead._id;
      
      if (payload.action === 'Followup' || (payload.action === 'Lead' && payload.status === 'Call Back')) {
        const checkRes = await api.get(`/contacts/${cid}/check-callback`);
        if (checkRes.data.exists) {
          const existing = checkRes.data.callback;
          const choice = window.confirm(
            `A callback already exists for this contact scheduled for ${new Date(existing.callBackDt).toLocaleString()}.\n\n` +
            `Click OK to EDIT the existing callback.\n` +
            `Click CANCEL to CREATE A NEW separate callback record.`
          );

          if (choice) {
            await api.put(`/leads/callbacks/${existing._id}`, {
              callBackDt: payload.callBackDt,
              remarks: payload.remarks || `[Call Action: ${payload.action}]`
            });
            alert('Existing callback updated successfully!');
            setCallActionLead(null);
            fetchData();
            return;
          }
        }
      }

      await api.post(`/leads/${callActionLead._id}/clone-and-dispose`, payload);
      setCallActionLead(null);
      fetchData(); // Refresh the list
      alert('Action logged successfully on a new clone of this contact!');
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    }
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
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 'var(--h1)', fontWeight: 900, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Award size={20} color="var(--success)" /> My Leads
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4 }}>Track and manage your successful conversions</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {user?.role === 'admin' && filtered.length > 0 && (
            <>
              <button className="btn btn-outline" onClick={toggleSelectAll} style={{ fontSize: '0.75rem', padding: '6px 12px' }}>
                {selectedIds.length === filtered.length ? <CheckSquare size={14} /> : <Square size={14} />}
                {selectedIds.length === filtered.length ? 'Deselect' : 'Select All'}
              </button>
              {selectedIds.length > 0 && (
                <button className="btn btn-danger" onClick={handleBulkDelete} style={{ fontSize: '0.75rem', padding: '6px 12px' }}>
                  <Trash2 size={14} /> Delete ({selectedIds.length})
                </button>
              )}
            </>
          )}
          <div className="badge badge-primary">
            {filtered.length} Leads
          </div>
        </div>
      </div>

      <div className="grid-stats" style={{ marginBottom: 20 }}>
        <div className="glass-panel" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 44, height: 44, background: 'var(--success-light)', color: 'var(--success)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Target size={20} /></div>
          <div><div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-primary)' }}>{stats.totalLeads}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>Total Leads</div></div>
        </div>
        <div className="glass-panel" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 44, height: 44, background: 'var(--violet-light)', color: 'var(--violet)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><TrendingUp size={20} /></div>
          <div><div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-primary)' }}>₹{stats.totalAmount.toLocaleString()}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>Total Revenue</div></div>
        </div>
      </div>

      <div className="glass-panel" style={{ marginBottom: 20, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" className="input-field" placeholder="Search by name, phone…" style={{ paddingLeft: 36, marginBottom: 0 }} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>

        <select className="input-field" style={{ width: 'auto', flex: 1, minWidth: 140, marginBottom: 0 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="Converted">Converted</option>
          <option value="Not Interested">Not Interested</option>
          <option value="DNC/DND">DNC/DND</option>
          <option value="Call Back">Call Back</option>
          <option value="Others">Others</option>
        </select>

        <select className="input-field" style={{ width: 'auto', flex: 1, minWidth: 140, marginBottom: 0 }} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
          <option value="all">All Sources</option>
          <option value="created">Agent Added</option>
          <option value="uploaded">Uploaded</option>
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


                <div className="lead-card-container">
                  <div className="lead-card-main">
                    <div style={{ display: 'flex', gap: 'var(--gap)', alignItems: 'center', flex: 1, minWidth: 0 }}>
                      <div className="lead-card-icon" style={{
                        background: isConverted ? 'linear-gradient(135deg,var(--success),#059669)' : isNegative ? 'linear-gradient(135deg,var(--danger),#b91c1c)' : 'var(--bg-surface-2)',
                        color: (isConverted || isNegative) ? '#fff' : 'var(--text-muted)'
                      }}>
                        <Star size={22} fill={(isConverted || isNegative) ? "white" : "none"} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                          {name}
                          {lead.status === 'Call Back' && <span className="badge badge-cyan" style={{ fontSize: '0.6rem', marginLeft: 8 }}>Lead Callback</span>}
                        </h3>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 500 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><PhoneCall size={12} /> {phone}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={12} /> {new Date(lead.lastModified || lead.createdAt).toLocaleDateString()}</span>
                          {lead.leadsCount > 1 && (
                            <button onClick={() => fetchHistory(phone, name)} style={{ color: 'var(--violet)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                              <TrendingUp size={12} /> {lead.leadsCount} Conv.
                            </button>
                          )}
                        </div>

                        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select className="input-field" style={{ marginBottom: 0, padding: '2px 8px', fontSize: '0.7rem', height: 28, width: 'auto', minWidth: 110, cursor: isLocked ? 'not-allowed' : 'pointer' }} value={lead.status || ''} disabled={isLocked} onChange={(e) => handleStatusChange(lead, e.target.value, 'contact')}>
                            <option value="">Set Status</option>
                            <option value="Converted">Converted</option>
                            <option value="Not Interested">Not Interested</option>
                            <option value="DNC/DND">DNC/DND</option>
                            <option value="Call Back">Call Back</option>
                            <option value="Others">Others</option>
                          </select>

                          {lead.status === 'Call Back' && lead.callBackDt && (
                            <span className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>
                              <Calendar size={10} /> {new Date(lead.callBackDt).toLocaleDateString()}
                            </span>
                          )}
                          {lead.transactionId && <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>UTR: {lead.transactionId}</span>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="lead-card-actions">
                    <div className="lead-amount-box" style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Amount</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--success)', lineHeight: 1, margin: '2px 0' }}>₹{(lead.leadAmount || 0).toLocaleString()}</div>
                      {lead.totalAmount > lead.leadAmount && <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--violet)' }}>Total: ₹{lead.totalAmount.toLocaleString()}</div>}
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      {user?.role !== 'admin' && phone !== 'N/A' && (
                        <button 
                          className="btn btn-primary btn-icon" 
                          style={{ width: 36, height: 36, borderRadius: 10 }}
                          onClick={() => {
                            window.location.href = `tel:${phone}`;
                            setCallActionLead(lead);
                          }}
                        >
                          <PhoneCall size={16} fill="white" />
                        </button>
                      )}
                      {user?.role === 'admin' && (
                        <button className="btn btn-danger btn-icon" onClick={() => handleDelete(lead._id)} style={{ width: 36, height: 36, borderRadius: 10 }}>
                          <Trash2 size={16} />
                        </button>
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
        .lead-list-item { transition: all 0.2s; }
        .lead-list-item:hover { transform: translateX(4px); box-shadow: var(--shadow-lg); }
        
        .lead-card-container { display: flex; justify-content: space-between; alignItems: center; gap: 20px; padding-left: 32px; }
        .lead-card-main { display: flex; gap: 18, alignItems: center; flex: 1; minWidth: 0; }
        .lead-card-icon { width: 50px; height: 50px; border-radius: var(--r-md); display: flex; alignItems: center; justify-content: center; flex-shrink: 0; }
        .lead-card-actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-end; min-width: 120px; }

        @media (max-width: 768px) {
          .lead-card-container { flex-direction: column; align-items: stretch; gap: 16px; padding-left: 0; padding-top: 24px; }
          .lead-card-actions { flex-direction: row; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 12px; }
          .lead-card-actions .lead-amount-box { text-align: left; }
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

      {callActionLead && (
        <CallActionModal
          lead={callActionLead}
          onClose={() => setCallActionLead(null)}
          onSubmit={handleCallActionSubmit}
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
