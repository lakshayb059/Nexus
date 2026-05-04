import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import {
  Database, Search, PhoneCall, Check, X, Calendar,
  Star, Clock, Plus, Trash2, Filter, TrendingUp, Lock, CheckSquare, Square
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
      const remarkWords = dispForm.remarks.trim().split(/\s+/).filter(w => w.length > 0);
      if (remarkWords.length < 2) { alert('Remarks must be at least 2 words long'); return; }

      let transactionId = '';
      if (dispForm.disposition === 'Lead') {
        const tid = window.prompt('Please enter Transaction ID:');
        if (tid === null) return;
        transactionId = tid;
      }

      const payload = { ...dispForm, transactionId };
      if (payload.appointmentDt) payload.appointmentDt = new Date(payload.appointmentDt).toISOString();
      
      await api.post(`/contacts/${selectedContact._id}/dispose`, payload);
      setSelectedContact(null);
      setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '' });
      fetchContacts();
    } catch (err) {
      alert(err.response?.data?.error || 'Disposition failed');
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

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(c => c._id));
    }
  };

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
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>{icon} {title}</h1>
          <p className="page-subtitle">{filterType === 'workflow' ? 'Your pending contacts to call' : `Manage and view your ${title.toLowerCase()}`}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {user?.role === 'admin' && (
            <button className="btn btn-outline" onClick={toggleSelectAll} style={{ padding: '7px 14px', fontSize: '0.8rem' }}>
              {selectedIds.length === filtered.length ? <CheckSquare size={15} /> : <Square size={15} />} 
              {selectedIds.length === filtered.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          {selectedIds.length > 0 && user?.role === 'admin' && (
            <button className="btn btn-danger" onClick={handleBulkDelete} style={{ boxShadow: '0 4px 12px rgba(239,68,68,0.3)' }}>
              <Trash2 size={15} /> Delete Selected ({selectedIds.length})
            </button>
          )}
          <span className="badge badge-primary" style={{ padding: '7px 14px', fontSize: '0.8rem' }}>{filtered.length} Records</span>
        </div>
      </div>

      {filterType === 'leads' && (
        <div className="glass-panel" style={{ marginBottom: 'var(--gap)', padding: 'var(--card-p)', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap', boxShadow: '0 10px 30px rgba(16,185,129,0.25)' }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fff', marginBottom: 6 }}>Total Revenue Generated</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', lineHeight: 1 }}>₹{totalLeadValue.toLocaleString()}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fff', marginBottom: 6 }}>Total Leads</div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fff' }}>{filtered.length}</div>
          </div>
        </div>
      )}

      <div className="glass-panel" style={{ marginBottom: 'var(--gap)', padding: '14px 18px' }}>
        <div className="contacts-filter-row">
          <div style={{ flex: 1, position: 'relative', minWidth: 180 }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="text" className="input-field" placeholder="Search..." style={{ paddingLeft: 42, marginBottom: 0 }} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          {user?.role === 'admin' && (
            <>
              <select className="input-field" style={{ marginBottom: 0, minWidth: 150 }} value={selectedTl} onChange={e => setSelectedTl(e.target.value)}>
                <option value="">All TLs</option>
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

      <div className="grid-cards">
        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : filtered.length === 0 ? (
          <div className="glass-panel" style={{ padding: '60px 40px', textAlign: 'center', gridColumn: '1 / -1' }}><h3>No contacts found</h3></div>
        ) : (
          filtered.map(contact => {
            const fields = contact.fields || {};
            const mainName = fields.Name || fields.name || 'Unknown';
            const phone = fields.Phone || fields.phone || fields.Mobile || 'No Phone';
            const disp = DISPS.find(d => d.key === contact.disposition);
            const isSel = selectedIds.includes(contact._id);
            const isLocked = user.role === 'agent' && contact.status === 'Converted' && contact.transactionId;

            return (
              <div key={contact._id} className="glass-panel contact-card" style={{ border: isSel ? '2px solid var(--primary)' : undefined }}>
                {user?.role === 'admin' && (
                  <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleSelect(contact._id)} style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--primary)' }} />
                  </div>
                )}
                
                <div className="contact-card-header" style={{ paddingLeft: user?.role === 'admin' ? 28 : 0 }}>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>{mainName}</h3>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}><PhoneCall size={13} /> {phone}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {disp && <span className="badge" style={{ background: `${disp.color}18`, color: disp.color }}>{disp.label}</span>}
                    {contact.leadAmount > 0 && <div className="badge badge-success">₹{contact.leadAmount.toLocaleString()}</div>}
                  </div>
                </div>

                <div className="contact-fields-area">
                  {Object.entries(fields).slice(0, 4).map(([k, v]) => (
                    <div key={k} className="contact-field-item">
                      <span className="field-label">{k}</span>
                      <span className="field-value">{String(v)}</span>
                    </div>
                  ))}
                  {contact.remarks && <div className="contact-remarks">"{contact.remarks}"</div>}
                  {contact.transactionId && <div style={{ gridColumn: '1 / -1', fontSize: '0.75rem', fontWeight: 700, color: '#10b981' }}>UTR/ID: {contact.transactionId}</div>}
                  
                  {filterType === 'leads' && (
                    <div style={{ gridColumn: '1 / -1', marginTop: 10 }}>
                      <select className="input-field" value={contact.status || ''} disabled={isLocked}
                        onChange={async (e) => {
                          const newStatus = e.target.value;
                          let transactionId = contact.transactionId;
                          if (newStatus === 'Converted') {
                            const tid = window.prompt('Enter Transaction ID:', transactionId || '');
                            if (tid === null) return;
                            transactionId = tid;
                          }
                          try {
                            await api.put(`/contacts/${contact._id}/status`, { status: newStatus, transactionId });
                            fetchContacts();
                          } catch(err) { alert(err.response?.data?.error || 'Update failed'); }
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
                  )}
                </div>

                <div className="contact-card-footer">
                  <span style={{ fontSize: '0.75rem' }}>Agent: <strong>{contact.agentName}</strong></span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {user?.role === 'admin' && <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(contact._id)}><Trash2 size={15} style={{ color: 'var(--danger)' }} /></button>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Disposition Modal */}
      {selectedContact && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header"><h2>Update Disposition</h2><button onClick={() => setSelectedContact(null)}><X size={18} /></button></div>
            <form onSubmit={handleDispose}>
              <select className="input-field" value={dispForm.disposition} onChange={e => setDispForm({ ...dispForm, disposition: e.target.value })} required>
                <option value="">-- Select --</option>
                {DISPS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <textarea className="input-field" rows="3" value={dispForm.remarks} onChange={e => setDispForm({ ...dispForm, remarks: e.target.value })} placeholder="Notes (min 2 words)..." required />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setSelectedContact(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .contacts-filter-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .contact-card { padding: 16px; position: relative; border-radius: var(--r-md); background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .contact-card-header { display: flex; justify-content: space-between; margin-bottom: 12px; }
        .contact-fields-area { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px; background: var(--bg-surface-2); border-radius: var(--r-md); }
        .field-label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; }
        .field-value { font-size: 0.8rem; font-weight: 600; }
        .contact-remarks { grid-column: 1 / -1; font-size: 0.75rem; font-style: italic; color: var(--text-muted); }
        .contact-card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
      `}</style>
    </div>
  );
};

export default Contacts;
