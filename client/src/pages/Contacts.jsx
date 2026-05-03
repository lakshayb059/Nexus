import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import {
  Database, Search, PhoneCall, Check, X, Calendar,
  Star, Clock, Plus, Trash2, Filter, TrendingUp
} from 'lucide-react';

const DISPS = [
  { key: 'Lead',            label: 'Lead',              color: '#10b981' },
  { key: 'Appointment',     label: 'Appointment',       color: '#8b5cf6' },
  { key: 'CallNotAnswered', label: 'Call Not Answered', color: '#f59e0b' },
  { key: 'HungUp',          label: 'Hung Up',           color: '#f43f5e' },
  { key: 'Invalid',         label: 'Invalid / Wrong No.', color: '#ef4444' },
  { key: 'DoNotCall',       label: 'Do Not Call',       color: '#64748b' },
  { key: 'CallBack',        label: 'Call Back',         color: '#06b6d4' },
];

const Contacts = ({ filterType }) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const location = useLocation();
  const [contacts, setContacts]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [searchTerm, setSearchTerm]   = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  const [selectedContact, setSelectedContact] = useState(null);
  const [dispForm, setDispForm] = useState({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '' });

  const [reassigning, setReassigning] = useState(null);
  const [targetAgent, setTargetAgent] = useState('');
  const [teamAgents, setTeamAgents]   = useState([]);

  const [selectedTl,       setSelectedTl]       = useState('');
  const [selectedAgent,    setSelectedAgent]    = useState('');
  const [tls,              setTls]              = useState([]);
  const [allAgents,        setAllAgents]        = useState([]);
  const [filteredAgents,   setFilteredAgents]   = useState([]);

  const fetchContacts = async () => {
    try {
      let query = '';
      if (filterType === 'leads')        query = '?disposition=Lead';
      else if (filterType === 'appointments') query = '?disposition=Appointment';
      else if (filterType === 'workflow') query = '?disposition=pending';
      const connector = query ? '&' : '?';
      if (selectedTl)    query += `${connector}tlId=${selectedTl}`;
      if (selectedAgent) query += `${query.includes('?') ? '&' : '?'}agentId=${selectedAgent}`;

      const res = await api.get(`/contacts${query}`);
      setContacts(res.data);

      if (user?.role === 'tl') {
        const teamRes = await api.get('/users/my-agents');
        setTeamAgents(teamRes.data);
      }
      if (user?.role === 'admin' && tls.length === 0) {
        const usersRes = await api.get('/users');
        const all = usersRes.data;
        setTls(all.filter(u => u.role === 'tl'));
        setAllAgents(all.filter(u => u.role === 'agent'));
        setFilteredAgents(all.filter(u => u.role === 'agent'));
      }
    } catch (err) {
      console.error('Fetch contacts failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
    if (!socket) return;
    const handler = () => fetchContacts();
    ['contacts_updated', 'batch_uploaded', 'users_updated'].forEach(e => socket.on(e, handler));
    return () => ['contacts_updated', 'batch_uploaded', 'users_updated'].forEach(e => socket.off(e, handler));
  }, [filterType, socket, location.pathname, selectedTl, selectedAgent]);

  useEffect(() => {
    if (selectedTl) {
      setFilteredAgents(allAgents.filter(a => a.tlId === selectedTl));
    } else {
      setFilteredAgents(allAgents);
    }
  }, [selectedTl, allAgents]);

  const filtered = contacts.filter(c => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return Object.values(c.fields || {}).some(v => String(v).toLowerCase().includes(q)) ||
           (c.agentName && c.agentName.toLowerCase().includes(q));
  });

  const handleDispose = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...dispForm };
      if (payload.appointmentDt) payload.appointmentDt = new Date(payload.appointmentDt).toISOString();
      
      await api.post(`/contacts/${selectedContact._id}/dispose`, payload);
      setSelectedContact(null);
      setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '' });
    } catch (err) {
      alert(err.response?.data?.error || 'Disposition failed');
    }
  };

  const handleReassign = async () => {
    try {
      await api.put(`/contacts/${reassigning._id}`, { assignedTo: targetAgent });
      setReassigning(null);
      setTargetAgent('');
      fetchContacts();
    } catch (err) {
      alert(err.response?.data?.error || 'Reassignment failed');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this contact?')) return;
    try {
      await api.delete(`/contacts/${id}`);
      fetchContacts();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.length} selected contacts?`)) return;
    try {
      await api.post('/contacts/bulk-delete', { ids: selectedIds });
      setSelectedIds([]);
      fetchContacts();
    } catch (err) {
      alert('Bulk delete failed');
    }
  };

  const toggleSelect = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const totalLeadValue = contacts.reduce((s, c) => s + (Number(c.leadAmount) || 0), 0);

  const pageInfo = {
    leads:        { title: 'Leads',         icon: <Star size={22} style={{ color: '#10b981' }} /> },
    appointments: { title: 'Appointments',  icon: <Calendar size={22} style={{ color: '#8b5cf6' }} /> },
    workflow:     { title: 'Workflow Queue', icon: <Clock size={22} style={{ color: '#f59e0b' }} /> },
    all:          { title: 'All Contacts',  icon: <Database size={22} style={{ color: 'var(--primary)' }} /> },
  };
  const { title, icon } = pageInfo[filterType] || pageInfo.all;

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>
            {icon} {title}
          </h1>
          <p className="page-subtitle">
            {filterType === 'workflow' ? 'Your pending contacts to call' : `Manage and view your ${title.toLowerCase()}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {selectedIds.length > 0 && user?.role === 'admin' && (
            <button className="btn btn-danger" onClick={handleBulkDelete}>
              <Trash2 size={15} /> Delete {selectedIds.length}
            </button>
          )}
          <span className="badge badge-primary" style={{ padding: '7px 14px', fontSize: '0.8rem' }}>
            {filtered.length} Records
          </span>
        </div>
      </div>

      {/* Revenue banner (leads only) */}
      {filterType === 'leads' && (
        <div className="glass-panel" style={{
          marginBottom: 'var(--gap)',
          padding: 'var(--card-p)',
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          border: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
          boxShadow: '0 10px 30px rgba(16,185,129,0.25)',
        }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fff', marginBottom: 6 }}>
              Total Revenue Generated
            </div>
            <div style={{ fontSize: 'clamp(1.8rem, 6vw, 2.5rem)', fontWeight: 900, color: '#fff', lineHeight: 1 }}>
              ₹{totalLeadValue.toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fff', marginBottom: 6 }}>
              Total Leads
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fff' }}>{filtered.length}</div>
          </div>
        </div>
      )}

      {/* Filters bar */}
      <div className="glass-panel" style={{ marginBottom: 'var(--gap)', padding: '14px 18px' }}>
        <div className="contacts-filter-row">
          <div style={{ flex: 1, position: 'relative', minWidth: 180 }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="input-field"
              placeholder="Search by name, phone, agent…"
              style={{ paddingLeft: 42, marginBottom: 0 }}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          {user?.role === 'admin' && (
            <>
              <select className="input-field" style={{ marginBottom: 0, minWidth: 150 }} value={selectedTl} onChange={e => setSelectedTl(e.target.value)}>
                <option value="">All Team Leads</option>
                {tls.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
              </select>
              <select className="input-field" style={{ marginBottom: 0, minWidth: 150 }} value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}>
                <option value="">All Agents</option>
                {filteredAgents.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid-cards">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-panel" style={{ padding: 'var(--card-p)' }}>
              <div className="skeleton" style={{ height: 14, width: '55%', marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 11, width: '35%', marginBottom: 20 }} />
              <div className="skeleton" style={{ height: 80, marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 36 }} />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="glass-panel" style={{ padding: '60px 40px', textAlign: 'center', gridColumn: '1 / -1' }}>
            <Database size={48} style={{ opacity: 0.15, margin: '0 auto 16px', display: 'block' }} />
            <h3 style={{ marginBottom: 8 }}>No contacts found</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Try adjusting your search or filters.</p>
          </div>
        ) : (
          filtered.map(contact => {
            const fields   = contact.fields || {};
            const mainName = fields.Name || fields.name || 'Unknown Contact';
            const phone    = fields.Phone || fields.phone || fields.Mobile || 'No Phone';
            const disp     = DISPS.find(d => d.key === contact.disposition);
            const isSel    = selectedIds.includes(contact._id);

            return (
              <div
                key={contact._id}
                className="glass-panel contact-card"
                style={{ border: isSel ? '1px solid var(--primary)' : undefined }}
              >
                {/* Checkbox (admin) */}
                {user?.role === 'admin' && (
                  <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 2 }}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelect(contact._id)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }}
                    />
                  </div>
                )}

                {/* Card header */}
                <div className="contact-card-header" style={{ paddingLeft: user?.role === 'admin' ? 28 : 0 }}>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 3 }}>{mainName}</h3>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      <PhoneCall size={13} /> {phone}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                    {disp ? (
                      <span className="badge" style={{ background: `${disp.color}18`, color: disp.color, border: `1px solid ${disp.color}30` }}>
                        {disp.label}
                      </span>
                    ) : (
                      <span className="badge badge-warning">Pending</span>
                    )}
                    {contact.leadAmount > 0 && (
                      <span className="badge badge-success">₹{contact.leadAmount.toLocaleString()}</span>
                    )}
                  </div>
                </div>

                {/* Fields */}
                <div className="contact-fields-area">
                  {(filterType === 'leads' ? Object.entries(fields) : Object.entries(fields).slice(0, 4)).map(([k, v]) => (
                    <div key={k} className="contact-field-item">
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(v)}</span>
                    </div>
                  ))}
                  {contact.remarks && (
                    <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', paddingTop: 4 }}>
                      "{contact.remarks}"
                    </div>
                  )}
                  {filterType === 'leads' && (
                    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Lead Status</div>
                      <select 
                        className="input-field" 
                        style={{ marginBottom: 6, padding: '4px 10px', fontSize: '0.75rem', height: 32, width: '100%' }}
                        value={contact.status || ''}
                        onChange={async (e) => {
                          try {
                            const newStatus = e.target.value;
                            await api.put(`/contacts/${contact._id}/status`, { status: newStatus });
                            fetchContacts();
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
                      
                      {/* Show additional fields based on status selection */}
                      {contact.status === 'Call Back' && (
                        <div style={{ marginTop: 6 }}>
                          <input 
                            type="datetime-local" 
                            className="input-field" 
                            style={{ marginBottom: 0, padding: '4px 10px', fontSize: '0.75rem', height: 32, width: '100%' }}
                            placeholder="Callback Date & Time"
                            min={new Date(Date.now() + 3600000).toISOString().slice(0, 16)}
                            onChange={async (e) => {
                              try {
                                await api.put(`/contacts/${contact._id}/status`, { 
                                  status: contact.status,
                                  callBackDt: e.target.value 
                                });
                                fetchContacts();
                              } catch(err) { alert('Failed to update callback time'); }
                            }}
                          />
                          <small style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block', marginTop: 2 }}>
                            Schedule at least 1 hour from now
                          </small>
                        </div>
                      )}
                      
                      {contact.status === 'Others' && (
                        <div style={{ marginTop: 6 }}>
                          <textarea 
                            className="input-field" 
                            style={{ marginBottom: 0, padding: '6px 10px', fontSize: '0.75rem', width: '100%', minHeight: 60, resize: 'vertical' }}
                            placeholder="Enter details for 'Others' status..."
                            onChange={async (e) => {
                              try {
                                await api.put(`/contacts/${contact._id}/status`, { 
                                  status: contact.status,
                                  statusDetails: e.target.value 
                                });
                                fetchContacts();
                              } catch(err) { alert('Failed to update status details'); }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="contact-card-footer">
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Agent: <strong style={{ color: 'var(--text-secondary)' }}>{contact.agentName}</strong>
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {user?.role === 'agent' && !contact.disposition && (
                      <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                        onClick={() => { setSelectedContact(contact); setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '' }); }}>
                        <Check size={13} /> Dispose
                      </button>
                    )}
                    {user?.role === 'tl' && !contact.disposition && (
                      <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                        onClick={() => { setReassigning(contact); setTargetAgent(''); }}>
                        <Plus size={13} /> Assign
                      </button>
                    )}
                    {user?.role === 'admin' && (
                      <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(contact._id)}>
                        <Trash2 size={15} style={{ color: 'var(--danger)' }} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Disposition Modal */}
      {selectedContact && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSelectedContact(null)}>
          <div className="modal-box animate-fade-in">
            <div className="modal-header">
              <h2>Update Disposition</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setSelectedContact(null)}><X size={18} /></button>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 20 }}>
              Contact: <strong style={{ color: 'var(--text-primary)' }}>{selectedContact.fields?.Name || selectedContact.fields?.name}</strong>
            </p>
            <form onSubmit={handleDispose}>
              <div className="input-group">
                <label>Outcome *</label>
                <select className="input-field" value={dispForm.disposition} onChange={e => setDispForm({ ...dispForm, disposition: e.target.value })} required>
                  <option value="">-- Select outcome --</option>
                  {DISPS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
              {dispForm.disposition === 'Appointment' && (
                <div className="input-group">
                  <label>Appointment Date & Time *</label>
                  <input type="datetime-local" className="input-field" value={dispForm.appointmentDt} onChange={e => setDispForm({ ...dispForm, appointmentDt: e.target.value })} required />
                </div>
              )}
              {dispForm.disposition === 'Lead' && (
                <div className="input-group">
                  <label>Lead Amount (₹) *</label>
                  <input type="number" className="input-field" placeholder="Enter deal amount" value={dispForm.leadAmount} onChange={e => setDispForm({ ...dispForm, leadAmount: e.target.value })} required min="1" />
                </div>
              )}
              <div className="input-group">
                <label>Remarks / Notes</label>
                <textarea className="input-field" rows="3" value={dispForm.remarks} onChange={e => setDispForm({ ...dispForm, remarks: e.target.value })} placeholder="Optional notes…" />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn btn-outline" onClick={() => setSelectedContact(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!dispForm.disposition}>Save Disposition</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reassign Modal */}
      {reassigning && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setReassigning(null)}>
          <div className="modal-box animate-fade-in">
            <div className="modal-header">
              <h2>Assign to Agent</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setReassigning(null)}><X size={18} /></button>
            </div>
            <div className="input-group">
              <label>Select Agent</label>
              <select className="input-field" value={targetAgent} onChange={e => setTargetAgent(e.target.value)}>
                <option value="">-- Choose agent --</option>
                {teamAgents.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-outline" onClick={() => setReassigning(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleReassign} disabled={!targetAgent}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .contacts-filter-row {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .contact-card {
          padding: var(--card-p);
          display: flex;
          flex-direction: column;
          gap: 14px;
          position: relative;
          transition: transform var(--t-base), box-shadow var(--t-base);
        }
        .contact-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 28px rgba(0,0,0,0.35);
        }
        .contact-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .contact-fields-area {
          background: var(--bg-surface-2);
          border-radius: var(--r-md);
          padding: 12px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          flex: 1;
        }
        .contact-field-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow: hidden;
        }
        .contact-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 10px;
          border-top: 1px solid var(--border);
        }
        @media (max-width: 480px) {
          .contacts-filter-row { flex-direction: column; }
          .contacts-filter-row .input-field { width: 100%; }
          .contact-fields-area { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
};

export default Contacts;
