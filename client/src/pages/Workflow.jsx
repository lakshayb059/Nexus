import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useLocation } from 'react-router-dom';
import api from '../utils/api';
import {
  PhoneCall, Check, Clock, Database, CheckCircle2,
  LayoutPanelLeft, RotateCw, X, Calendar, ArrowRight
} from 'lucide-react';

const DISPS = [
  { key: 'Lead',            label: 'Lead',              color: '#10b981', badgeClass: 'badge-success' },
  { key: 'Appointment',     label: 'Appointment',       color: '#8b5cf6', badgeClass: 'badge-violet' },
  { key: 'CallNotAnswered', label: 'Call Not Answered', color: '#f59e0b', badgeClass: 'badge-warning' },
  { key: 'HungUp',          label: 'Hung Up',           color: '#f43f5e', badgeClass: 'badge-danger' },
  { key: 'Invalid',         label: 'Invalid / Wrong No.',color: '#ef4444', badgeClass: 'badge-danger' },
  { key: 'DoNotCall',       label: 'Do Not Call',       color: '#64748b', badgeClass: 'badge-muted' },
  { key: 'CallBack',        label: 'Call Back',         color: '#06b6d4', badgeClass: 'badge-cyan' },
];

const LEAD_STATUS_OPTIONS = ['Converted', 'Not Interested', 'DNC/DND', 'Call Back', 'Others'];

const Workflow = () => {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const location   = useLocation();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dispForm,   setDispForm]   = useState({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', status: '', statusDetails: '', transactionId: '' });
  const [emptyStateContacts, setEmptyStateContacts] = useState(null);
  const [requeuing, setRequeuing] = useState(null);

  const fetchNext = async (cid) => {
    try {
      setLoading(true);
      const contactId = cid || new URLSearchParams(location.search).get('contactId');
      const url = contactId ? `/contacts/queue?contactId=${contactId}` : '/contacts/queue';
      const res = await api.get(url);
      setData(res.data);
      
      if (!res.data?.contact) {
        const allRes = await api.get('/contacts');
        setEmptyStateContacts(allRes.data);
      } else {
        setEmptyStateContacts(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNext();
  }, [location.search]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchNext();
    socket.on('contacts_updated',  refresh);
    socket.on('batch_uploaded',    refresh);
    socket.on('contact_disposed',  refresh);
    return () => {
      socket.off('contacts_updated',  refresh);
      socket.off('batch_uploaded',    refresh);
      socket.off('contact_disposed',  refresh);
    };
  }, [socket]);

  const handleDispose = async (e) => {
    e.preventDefault();
    if (!data?.contact) return;
    if (dispForm.disposition === 'Lead') {
      if (!dispForm.leadAmount) { alert('Amount is required'); return; }
      if (!dispForm.status) { alert('Lead Status is required'); return; }
      if (dispForm.status === 'Converted' && !dispForm.transactionId) { alert('Transaction ID is required'); return; }
      if (dispForm.status === 'Call Back' && !dispForm.callBackDt) { alert('Callback date is required'); return; }
      if (dispForm.status === 'Others' && !dispForm.statusDetails) { alert('Details are required'); return; }
    }
    const remarkWords = dispForm.remarks.trim().split(/\s+/).filter(w => w.length > 0);
    if (remarkWords.length < 2) { alert('Remarks must be at least 2 words long'); return; }

    setSubmitting(true);
    try {
      const payload = { ...dispForm };
      if (payload.appointmentDt) payload.appointmentDt = new Date(payload.appointmentDt).toISOString();
      if (payload.callBackDt) payload.callBackDt = new Date(payload.callBackDt).toISOString();
      await api.post(`/contacts/${data.contact._id}/dispose`, payload);
      setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', status: '', statusDetails: '', transactionId: '' });
      fetchNext();
    } catch (err) {
      alert(err.response?.data?.error || 'Disposition failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequeue = async (cid) => {
    setRequeuing(cid);
    try {
      await api.post(`/contacts/${cid}/requeue`);
      fetchNext();
    } catch (err) {
      alert('Failed to re-queue');
    } finally {
      setRequeuing(null);
    }
  };

  if (loading && !data) return <div style={{ textAlign: 'center', padding: '100px' }}>Loading...</div>;

  if (!data?.contact) {
    const appts = emptyStateContacts?.filter(c => c.disposition === 'Appointment') || [];
    const cbs = emptyStateContacts?.filter(c => c.disposition === 'CallBack') || [];

    return (
      <div>
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', maxWidth: 700, margin: '20px auto' }}>
          <CheckCircle2 size={56} style={{ color: 'var(--success)', marginBottom: 16 }} />
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Primary Queue Complete!</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>You have finished all fresh contacts. Manage your scheduled follow-ups below.</p>
          <button className="btn btn-outline" onClick={() => fetchNext()}><RotateCw size={14} /> Refresh List</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 40 }}>
          {/* Appointments Section */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#8b5cf6', marginBottom: 20 }}>
              <Calendar size={20} /> My Appointments <span className="badge badge-violet">{appts.length}</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {appts.length === 0 ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>No scheduled appointments</p> : 
                appts.map(c => (
                  <div key={c._id} className="glass-panel" style={{ padding: '12px 16px', background: 'var(--bg-surface-2)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.fields?.Name || 'Unknown'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Clock size={12} /> {new Date(c.appointmentDt).toLocaleString()}
                        </div>
                      </div>
                      <button className="btn btn-primary btn-icon" onClick={() => handleRequeue(c._id)} disabled={requeuing === c._id}>
                        {requeuing === c._id ? <RotateCw className="animate-spin" size={14} /> : <ArrowRight size={14} />}
                      </button>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Callbacks Section */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#06b6d4', marginBottom: 20 }}>
              <Clock size={20} /> My Callbacks <span className="badge badge-cyan">{cbs.length}</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {cbs.length === 0 ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>No pending callbacks</p> : 
                cbs.map(c => (
                  <div key={c._id} className="glass-panel" style={{ padding: '12px 16px', background: 'var(--bg-surface-2)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.fields?.Name || 'Unknown'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Clock size={12} /> {c.callBackDt ? new Date(c.callBackDt).toLocaleString() : 'No date'}
                        </div>
                      </div>
                      <button className="btn btn-primary btn-icon" onClick={() => handleRequeue(c._id)} disabled={requeuing === c._id}>
                        {requeuing === c._id ? <RotateCw className="animate-spin" size={14} /> : <ArrowRight size={14} />}
                      </button>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { contact, remaining, total, disposed } = data;
  const fields = contact.fields || {};

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title"><PhoneCall size={24} /> Workflow</h1>
        <div style={{ fontWeight: 800 }}>{remaining} Remaining</div>
      </div>
      <div className="workflow-grid">
        <div className="glass-panel" style={{ padding: 'var(--card-p)' }}>
          <h3>{fields.Name || 'Contact'} Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {Object.entries(fields).map(([k, v]) => (
              <div key={k} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontWeight: 600 }}>{String(v) || '—'}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="glass-panel" style={{ padding: 'var(--card-p)' }}>
          <h3>Disposition</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
            {DISPS.map(d => (
              <button key={d.key} type="button" onClick={() => setDispForm(p => ({ ...p, disposition: d.key, status: '', statusDetails: '', transactionId: '', leadAmount: '', appointmentDt: '', callBackDt: '' }))} style={{ padding: '10px', borderRadius: 'var(--r-md)', border: dispForm.disposition === d.key ? `2px solid ${d.color}` : '1px solid var(--border)', background: dispForm.disposition === d.key ? `${d.color}15` : 'var(--bg-surface-2)', color: dispForm.disposition === d.key ? d.color : 'inherit', cursor: 'pointer', fontWeight: 700 }}>{d.label}</button>
            ))}
          </div>
          <form onSubmit={handleDispose}>
            {dispForm.disposition === 'Lead' && (
              <>
                <div className="input-group">
                  <label>Amount (₹)</label>
                  <input type="number" className="input-field" value={dispForm.leadAmount} onChange={e => setDispForm(p => ({ ...p, leadAmount: e.target.value }))} required />
                </div>
                <div className="input-group">
                  <label>Status</label>
                  <select className="input-field" value={dispForm.status} onChange={e => setDispForm(p => ({ ...p, status: e.target.value }))} required>
                    <option value="">Select...</option>
                    {LEAD_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                {dispForm.status === 'Converted' && <div className="input-group"><label>UTR ID</label><input type="text" className="input-field" value={dispForm.transactionId} onChange={e => setDispForm(p => ({ ...p, transactionId: e.target.value }))} required /></div>}
                {dispForm.status === 'Call Back' && <div className="input-group"><label>Callback</label><input type="datetime-local" className="input-field" value={dispForm.callBackDt} onChange={e => setDispForm(p => ({ ...p, callBackDt: e.target.value }))} required /></div>}
                {dispForm.status === 'Others' && <div className="input-group"><label>Details</label><input type="text" className="input-field" value={dispForm.statusDetails} onChange={e => setDispForm(p => ({ ...p, statusDetails: e.target.value }))} required /></div>}
              </>
            )}
            {dispForm.disposition === 'Appointment' && <div className="input-group"><label>Date</label><input type="datetime-local" className="input-field" value={dispForm.appointmentDt} onChange={e => setDispForm(p => ({ ...p, appointmentDt: e.target.value }))} required /></div>}
            {dispForm.disposition === 'CallBack' && <div className="input-group"><label>Date</label><input type="datetime-local" className="input-field" value={dispForm.callBackDt} onChange={e => setDispForm(p => ({ ...p, callBackDt: e.target.value }))} required /></div>}
            <div className="input-group"><label>Remarks</label><textarea className="input-field" rows="3" value={dispForm.remarks} onChange={e => setDispForm(p => ({ ...p, remarks: e.target.value }))} required /></div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', height: 48 }} disabled={submitting}>{submitting ? 'Saving...' : 'Submit'}</button>
          </form>
        </div>
      </div>
      <style>{`
        .workflow-grid { display: grid; grid-template-columns: 1fr 380px; gap: 20px; }
        @media (max-width: 1024px) { .workflow-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
};

export default Workflow;
