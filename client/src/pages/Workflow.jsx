import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useLocation } from 'react-router-dom';
import api from '../utils/api';
import {
  PhoneCall, Check, Clock, Database, CheckCircle2,
  LayoutPanelLeft, RotateCw, X, Calendar, ArrowRight,
  TrendingUp, RefreshCw, AlertCircle, Phone
} from 'lucide-react';

const DISPS = [
  { key: 'Lead', label: 'Lead', color: '#10b981', badgeClass: 'badge-success' },
  { key: 'Appointment', label: 'Appointment', color: '#8b5cf6', badgeClass: 'badge-violet' },
  { key: 'CallNotAnswered', label: 'Call Not Answered', color: '#f59e0b', badgeClass: 'badge-warning' },
  { key: 'HungUp', label: 'Hung Up', color: '#f43f5e', badgeClass: 'badge-danger' },
  { key: 'Invalid', label: 'Invalid / Wrong No.', color: '#ef4444', badgeClass: 'badge-danger' },
  { key: 'DoNotCall', label: 'Do Not Call', color: '#64748b', badgeClass: 'badge-muted' },
  { key: 'CallBack', label: 'Call Back', color: '#06b6d4', badgeClass: 'badge-cyan' },
];

const LEAD_STATUS_OPTIONS = ['Converted', 'Not Interested', 'DNC/DND', 'Call Back', 'Others'];

const Workflow = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dispForm, setDispForm] = useState({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', status: '', statusDetails: '', transactionId: '' });
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
    socket.on('contacts_updated', refresh);
    socket.on('batch_uploaded', refresh);
    socket.on('contact_disposed', refresh);
    return () => {
      socket.off('contacts_updated', refresh);
      socket.off('batch_uploaded', refresh);
      socket.off('contact_disposed', refresh);
    };
  }, [socket]);

  const handleDispose = async (e) => {
    e.preventDefault();
    if (!data?.contact) return;

    // Validation
    if (dispForm.disposition === 'Lead') {
      if (!dispForm.leadAmount) { alert('Amount is required'); return; }
      if (!dispForm.status) { alert('Lead Status is required'); return; }
    }

    const remarkWords = dispForm.remarks.trim().split(/\s+/).filter(w => w.length > 0);
    if (remarkWords.length < 1) {
      alert('Remarks are mandatory (min 1 word)'); return;
    }

    setSubmitting(true);
    try {
      const payload = { ...dispForm };
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

  if (loading && !data) return <div style={{ textAlign: 'center', padding: '100px' }}>Loading Workflow...</div>;

  const total = data?.total || 0;
  const disposed = data?.disposed || 0;
  const progressPercent = total > 0 ? Math.round((disposed / total) * 100) : 0;

  if (!data?.contact) {
    const appts = emptyStateContacts?.filter(c => c.disposition === 'Appointment') || [];
    const cbs = emptyStateContacts?.filter(c => c.disposition === 'CallBack') || [];

    return (
      <div className="animate-fade-in">
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', maxWidth: 800, margin: '20px auto', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, background: '#e5e7eb' }}>
            <div style={{ width: '100%', height: '100%', background: 'var(--success)', transition: 'width 1s ease' }} />
          </div>
          <CheckCircle2 size={64} style={{ color: 'var(--success)', marginBottom: 20 }} />
          <h2 style={{ fontSize: '2.2rem', fontWeight: 900 }}>All Done!</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginBottom: 30 }}>You've successfully processed all assigned contacts. Great job!</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 30 }}>
            <div className="stat-pill"><strong>{total}</strong> Total</div>
            <div className="stat-pill" style={{ background: 'var(--success-light)', color: 'var(--success)' }}><strong>{disposed}</strong> Disposed</div>
          </div>
          <button className="btn btn-primary" onClick={() => fetchNext()}><RotateCw size={16} /> Refresh Queue</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 40 }}>
          <div className="glass-panel" style={{ padding: '24px', borderTop: '4px solid #8b5cf6' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#8b5cf6', marginBottom: 20 }}><Calendar size={20} /> My Appointments <span className="badge badge-violet">{appts.length}</span></h3>
            <div className="scheduled-list">
              {appts.map(c => (
                <div key={c._id} className="scheduled-item">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800 }}>{c.fields?.Name || 'Unknown'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(c.appointmentDt).toLocaleString()}</div>
                  </div>
                  <button className="btn btn-primary btn-icon" onClick={() => handleRequeue(c._id)} disabled={requeuing === c._id} title="Re-queue now"><ArrowRight size={14} /></button>
                </div>
              ))}
              {appts.length === 0 && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No appointments scheduled.</div>}
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '24px', borderTop: '4px solid #06b6d4' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#06b6d4', marginBottom: 20 }}><Clock size={20} /> My Callbacks <span className="badge badge-cyan">{cbs.length}</span></h3>
            <div className="scheduled-list">
              {cbs.map(c => (
                <div key={c._id} className="scheduled-item">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800 }}>{c.fields?.Name || 'Unknown'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(c.callBackDt).toLocaleString()}</div>
                  </div>
                  <button className="btn btn-primary btn-icon" onClick={() => handleRequeue(c._id)} disabled={requeuing === c._id} title="Re-queue now"><ArrowRight size={14} /></button>
                </div>
              ))}
              {cbs.length === 0 && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No pending callbacks.</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { contact, remaining, rechurnNum, type } = data;
  const fields = contact.fields || {};

  return (
    <div className="animate-fade-in">
      {/* Dynamic Progress Header */}
      <div className="workflow-header">
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
            <div>
              <h1 className="page-title" style={{ marginBottom: 0 }}><PhoneCall size={24} /> Calling Workflow</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Processing batch contacts...</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--primary)' }}>{progressPercent}% Complete</span>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{disposed} / {total} Contacts</div>
            </div>
          </div>
          <div className="progress-container">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>

      <div className="workflow-grid" style={{ marginTop: 24 }}>
        {/* Contact Info Card */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ margin: 0 }}>{fields.Name || 'Contact'} Info</h3>
            {type === 'rechurn' && (
              <div className="badge badge-warning" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}>
                <RefreshCw size={12} className="animate-spin-slow" />
                Recurring Attempt: {rechurnNum} of 3
              </div>
            )}
            {type === 'callback_due' && <div className="badge badge-cyan">Scheduled Callback Due</div>}
          </div>

          <div className="detail-grid">
            {Object.entries(fields).map(([k, v]) => {
              const isPhone = k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile');
              return (
                <div key={k} className="detail-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <span className="detail-label">{k}</span>
                      <span className="detail-value">{String(v) || '—'}</span>
                    </div>
                    {isPhone && v && (
                      <a href={`tel:${v}`} className="call-action-btn" title={`Call ${v}`}>
                        <Phone size={14} fill="currentColor" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {contact.lastCallAttempt && (
            <div style={{ marginTop: 'auto', paddingTop: 20, fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={14} /> Last attempt was on {new Date(contact.lastCallAttempt).toLocaleString()}
            </div>
          )}
        </div>

        {/* Disposition Form */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ marginBottom: 20 }}>Disposal Options</h3>

          <div className="dispo-buttons">
            {DISPS.map(d => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDispForm(p => ({ ...p, disposition: d.key, status: '', statusDetails: '', transactionId: '', leadAmount: '', appointmentDt: '', callBackDt: '' }))}
                className={`dispo-btn ${dispForm.disposition === d.key ? 'active' : ''}`}
                style={{ '--btn-color': d.color }}
              >
                {d.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleDispose} style={{ marginTop: 20 }}>
            {dispForm.disposition === 'Lead' && (
              <div className="animate-slide-up">
                <div className="input-group"><label>Lead Amount (₹)</label><input type="number" className="input-field" value={dispForm.leadAmount} onChange={e => setDispForm(p => ({ ...p, leadAmount: e.target.value }))} required /></div>
                <div className="input-group"><label>Lead Status</label><select className="input-field" value={dispForm.status} onChange={e => setDispForm(p => ({ ...p, status: e.target.value }))} required><option value="">Select Status...</option>{LEAD_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></div>
                {dispForm.status === 'Converted' && <div className="input-group"><label>Transaction ID / UTR</label><input type="text" className="input-field" value={dispForm.transactionId} onChange={e => setDispForm(p => ({ ...p, transactionId: e.target.value }))} required /></div>}
                {dispForm.status === 'Call Back' && <div className="input-group"><label>Callback Schedule</label><input type="datetime-local" className="input-field" value={dispForm.callBackDt} onChange={e => setDispForm(p => ({ ...p, callBackDt: e.target.value }))} required /></div>}
                {dispForm.status === 'Others' && <div className="input-group"><label>Details</label><input type="text" className="input-field" value={dispForm.statusDetails} onChange={e => setDispForm(p => ({ ...p, statusDetails: e.target.value }))} required /></div>}
              </div>
            )}

            {dispForm.disposition === 'Appointment' && (
              <div className="input-group animate-slide-up"><label>Appointment Date & Time</label><input type="datetime-local" className="input-field" value={dispForm.appointmentDt} onChange={e => setDispForm(p => ({ ...p, appointmentDt: e.target.value }))} required /></div>
            )}

            {dispForm.disposition === 'CallBack' && (
              <div className="input-group animate-slide-up"><label>Callback Date & Time</label><input type="datetime-local" className="input-field" value={dispForm.callBackDt} onChange={e => setDispForm(p => ({ ...p, callBackDt: e.target.value }))} required /></div>
            )}

            <div className="input-group">
              <label>Remarks (Min 1 word) *</label>
              <textarea className="input-field" rows="3" value={dispForm.remarks} onChange={e => setDispForm(p => ({ ...p, remarks: e.target.value }))} required placeholder="Enter call notes here..." />
            </div>

            <button type="submit" className="btn btn-primary submit-btn" disabled={submitting || !dispForm.disposition}>
              {submitting ? <RotateCw className="animate-spin" size={18} /> : <><Check size={18} /> Submit Disposition</>}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        .workflow-header { display: flex; align-items: center; gap: 30px; }
        .progress-container { height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary), #8b5cf6); transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1); }
        
        .workflow-grid { display: grid; grid-template-columns: 1fr 400px; gap: 24px; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; }
        .detail-item { padding: 12px 14px; background: #f8fafc; border-radius: 12px; border: 1px solid #f1f5f9; }
        .detail-label { display: block; font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; }
        .detail-value { font-size: 0.95rem; font-weight: 700; color: #1e293b; word-break: break-all; }

        .call-action-btn { 
          width: 28px; height: 28px; border-radius: 8px; background: #10b981; color: #fff; 
          display: flex; alignItems: center; justify-content: center; text-decoration: none;
          transition: transform 0.2s, background 0.2s;
        }
        .call-action-btn:hover { background: #059669; transform: scale(1.1); }

        .dispo-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .dispo-btn { 
          padding: 12px; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff; 
          color: #64748b; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;
        }
        .dispo-btn:hover { border-color: var(--btn-color); background: #f8fafc; }
        .dispo-btn.active { background: var(--btn-color); color: #fff; border-color: var(--btn-color); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }

        .submit-btn { width: 100%; height: 52px; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 1rem; }
        
        @media (max-width: 1024px) { .workflow-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
};

export default Workflow;
