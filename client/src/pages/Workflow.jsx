import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useLocation } from 'react-router-dom';
import api from '../utils/api';
import {
  PhoneCall, Check, Clock, Database, CheckCircle2,
  LayoutPanelLeft, RotateCw, X, Calendar
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

const Workflow = () => {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const location   = useLocation();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dispForm,   setDispForm]   = useState({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', statusDetails: '' });
  const [toasts,     setToasts]     = useState([]);
  const [emptyStateContacts, setEmptyStateContacts] = useState(null);
  const [selectedForRequeue, setSelectedForRequeue] = useState([]);
  const [requeuing, setRequeuing] = useState(false);

  const addToast = (msg, type) =>
    setToasts(p => [...p, { id: Date.now(), msg, type }]);
  const removeToast = (id) =>
    setToasts(p => p.filter(t => t.id !== id));

  const fetchNext = async (cid) => {
    try {
      setLoading(true);
      const params = new URLSearchParams(cid ? `?contactId=${cid}` : location.search);
      const contactId = params.get('contactId');
      const url = contactId ? `/contacts/queue?contactId=${contactId}` : '/contacts/queue';
      const res = await api.get(url);
      setData(res.data);
      if (!res.data?.contact && !cid) {
        console.log('Queue is empty');
        try {
          const allRes = await api.get('/contacts');
          setEmptyStateContacts(allRes.data);
        } catch (e) {
          console.error('Failed to fetch empty state contacts');
        }
      } else {
        setEmptyStateContacts(null);
      }
    } catch (err) {
      console.error('Queue fetch failed', err);
      // If 401, they will be redirected by axios interceptor
      // If other error, show message
      if (err.response?.status !== 401) {
        // Retry once for network errors
        if (err.code === 'NETWORK_ERROR' || !err.response) {
          try {
            console.log('Retrying queue fetch...');
            const retryRes = await api.get(url);
            setData(retryRes.data);
          } catch (retryErr) {
            console.error('Retry failed:', retryErr);
            addToast('Could not load queue. Please refresh the page.', 'error');
          }
        } else {
          addToast('Could not load queue. Please check your connection or permissions.', 'error');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const cid = params.get('contactId');
    fetchNext(cid);
  }, [location.search]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchNext();
    socket.on('contacts_updated',  refresh);
    socket.on('batch_uploaded',    refresh);
    socket.on('contact_disposed',  refresh);
    socket.on('appointment_reminder', (d) => {
      addToast(`📅 Appointment: ${d.contactName} in ${d.minutesUntil} min`, 'appointment');
      // Enhanced sound notification with fallback
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 0.5;
        audio.play().catch(e => {
          // Fallback to built-in notification sound if external fails
          try {
            const fallbackAudio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE');
            fallbackAudio.play();
          } catch(fallbackError) {
            console.log('Audio notification failed:', fallbackError);
          }
        });
      } catch(e) {
        console.log('Audio notification failed:', e);
      }
    });
    socket.on('callback_due', (d) => {
      addToast(`📞 Callback due: ${d.contactName}`, 'callback');
      try { new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3').play(); } catch(e){}
    });
    return () => {
      socket.off('contacts_updated',  refresh);
      socket.off('batch_uploaded',    refresh);
      socket.off('contact_disposed',  refresh);
      socket.off('appointment_reminder');
      socket.off('callback_due');
    };
  }, [socket]);

  const handleDispose = async (e) => {
    e.preventDefault();
    if (!data?.contact) return;
    if (dispForm.disposition === 'Lead' && (!dispForm.leadAmount || dispForm.leadAmount <= 0)) {
      alert('Valid Lead Amount is mandatory'); return;
    }
    if (dispForm.disposition === 'Appointment' && !dispForm.appointmentDt) {
      alert('Appointment date is required'); return;
    }
    if (dispForm.disposition === 'CallBack' && !dispForm.callBackDt) {
      alert('Callback date is required'); return;
    }

    const remarkWords = dispForm.remarks.trim().split(/\s+/).filter(w => w.length > 0);
    if (remarkWords.length < 2) {
      alert('Remarks must be at least 2 words long for every contact'); return;
    }

    let currentTransactionId = '';
    if (dispForm.disposition === 'Lead') {
      const tid = window.prompt('Please enter Transaction ID for confirmation:');
      if (tid === null) return; // User cancelled
      currentTransactionId = tid;
    }

    setSubmitting(true);
    try {
      const payload = { ...dispForm, transactionId: currentTransactionId };
      // Convert naive local datetime strings to ISO UTC
      if (payload.appointmentDt) payload.appointmentDt = new Date(payload.appointmentDt).toISOString();
      if (payload.callBackDt) payload.callBackDt = new Date(payload.callBackDt).toISOString();
      if (payload.disposition === 'Lead' && payload.statusDetails) {
        payload.status = 'Others';
      }

      await api.post(`/contacts/${data.contact._id}/dispose`, payload);
      setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', statusDetails: '' });
      fetchNext();
    } catch (err) {
      alert(err.response?.data?.error || 'Disposition failed');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSelection = (id) => {
    setSelectedForRequeue(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleBulkRequeue = async () => {
    if (selectedForRequeue.length === 0) return;
    setRequeuing(true);
    try {
      await Promise.all(selectedForRequeue.map(id => api.post(`/contacts/${id}/requeue`)));
      addToast(`Added ${selectedForRequeue.length} contacts back to workflow`, 'success');
      setSelectedForRequeue([]);
      fetchNext();
    } catch (err) {
      console.error(err);
      addToast('Failed to requeue some contacts', 'error');
    } finally {
      setRequeuing(false);
    }
  };

  /* ── Loading ── */
  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 20 }}>
        <div style={{ width: 48, height: 48, border: '3px solid var(--primary-light)', borderTopColor: 'var(--primary)', borderRadius: '50%' }} className="animate-spin" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading workflow…</p>
      </div>
    );
  }

  /* ── Empty ── */
  if (!data?.contact) {
    const partitions = {
      Appointment: [],
      CallBack: [],
      CallNotAnswered: [],
      HungUp: []
    };

    if (emptyStateContacts) {
      emptyStateContacts.forEach(c => {
        const isApptOrCb = c.disposition === 'Appointment' || c.disposition === 'CallBack';
        if ((c.queueOrder !== 999999 || isApptOrCb) && partitions[c.disposition]) {
          partitions[c.disposition].push(c);
        }
      });
    }

    return (
      <div>
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', maxWidth: 600, margin: '20px auto', marginBottom: 40 }}>
          <CheckCircle2 size={64} style={{ color: 'var(--success)', margin: '0 auto 20px', display: 'block', opacity: 0.7 }} />
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 10 }}>Queue Complete!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 28, lineHeight: 1.7 }}>
            Great work! You've disposed all fresh contacts in your primary queue.
          </p>
          <button className="btn btn-primary" style={{ padding: '12px 28px' }} onClick={() => fetchNext()}>
            <RotateCw size={16} /> Refresh Queue
          </button>
        </div>

        {emptyStateContacts && selectedForRequeue.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <button 
              className="btn btn-primary" 
              onClick={handleBulkRequeue}
              disabled={requeuing}
              style={{ padding: '12px 28px', display: 'flex', gap: 8, alignItems: 'center', boxShadow: '0 8px 20px rgba(124, 58, 237, 0.3)' }}
            >
              {requeuing ? (
                <span className="animate-spin" style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block' }} />
              ) : (
                <><RotateCw size={18} /> Add {selectedForRequeue.length} Selected to Workflow</>
              )}
            </button>
          </div>
        )}

        {emptyStateContacts && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {Object.entries(partitions).map(([disp, list]) => {
              if (list.length === 0) return null;
              const dispConfig = DISPS.find(d => d.key === disp);
              return (
                <div key={disp} className="glass-panel" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: dispConfig?.color || 'var(--primary)', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {dispConfig?.label || disp}
                    <span className="badge" style={{ background: `${dispConfig?.color}20`, color: dispConfig?.color }}>{list.length}</span>
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {list.map(c => (
                      <div key={c._id} style={{ padding: '12px', background: 'var(--bg-surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, paddingRight: 10 }}>
                          <input 
                            type="checkbox" 
                            checked={selectedForRequeue.includes(c._id)}
                            onChange={() => toggleSelection(c._id)}
                            style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--primary)', flexShrink: 0 }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.fields?.Name || c.fields?.name || 'Unknown'}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.fields?.Phone || c.fields?.phone || 'No phone'}</div>
                          </div>
                        </div>
                        <button className="btn btn-primary btn-icon" onClick={() => fetchNext(c._id)} title="Open in Workflow" style={{ flexShrink: 0 }}>
                          <PhoneCall size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const { contact, remaining, total, disposed } = data;
  const fields   = contact.fields || {};
  const progress = total > 0 ? Math.round((disposed / total) * 100) : 0;
  const isRecall = contact.disposition === 'CallNotAnswered';
  const isCallback = data.type === 'callback_due';

  return (
    <div>
      {/* Toast notifications */}
      <div style={{ position: 'fixed', top: 76, right: 20, zIndex: 1500, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
        {toasts.map(t => (
          <div key={t.id} className="glass-panel animate-fade-up" style={{
            padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            borderLeft: `4px solid ${t.type === 'appointment' ? '#8b5cf6' : '#06b6d4'}`,
          }}>
            <span style={{ fontSize: '0.875rem' }}>{t.msg}</span>
            <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => removeToast(t.id)}><X size={14} /></button>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>
            <PhoneCall size={24} style={{ color: 'var(--primary)' }} /> Agent Workflow
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              Calling: <strong style={{ color: 'var(--text-primary)' }}>{fields.Name || fields.name || 'Unknown'}</strong>
            </p>
            {isRecall   && <span className="badge badge-warning"><RotateCw size={11} /> RECALL</span>}
            {isCallback && <span className="badge badge-cyan"><Clock size={11} /> CALLBACK</span>}
            {data.type === 'fresh' && <span className="badge badge-success">FRESH DATA</span>}
            {data.type === 'rechurn' && (
              <span className="badge" style={{ backgroundColor: '#f59e0b15', color: '#f59e0b', border: '1px solid #f59e0b40' }}>
                RECHURN DATA (Attempt {data.rechurnNum || 1})
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Queue Progress</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>{remaining}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>remaining</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 'var(--gap)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          <span>{disposed} of {total} disposed</span>
          <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{progress}%</span>
        </div>
        <div className="progress-bar-track" style={{ height: 8 }}>
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Upcoming appointments banner */}
      {data.upcomingAppointments?.length > 0 && (
        <div className="glass-panel" style={{
          marginBottom: 'var(--gap)', padding: '14px 18px',
          background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
          border: 'none', display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <Calendar size={18} style={{ color: '#fff', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Upcoming Appointments</div>
            {data.upcomingAppointments.map(a => (
              <div key={a._id} style={{ fontSize: '0.875rem', color: '#fff', opacity: 0.9 }}>
                {a.fields?.Name || a.fields?.name} — {new Date(a.appointmentDt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="workflow-grid">
        {/* Contact details */}
        <div className="glass-panel" style={{ padding: 'var(--card-p)' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={16} style={{ color: 'var(--primary)' }} /> Contact Details
          </h2>
          <div className="contact-detail-grid">
            {Object.entries(fields).map(([k, v]) => {
              const isPhone = k.toLowerCase() === 'phone' || k.toLowerCase() === 'mobile';
              return (
                <div key={k} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{k}</div>
                  <div style={{ fontWeight: 600, fontSize: isPhone ? '1.05rem' : '0.9rem', color: isPhone ? 'var(--text-primary)' : 'inherit', wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span>{String(v) || '—'}</span>
                    {isPhone && v && String(v).trim() !== '' && (
                      <a 
                        href={`tel:${String(v).replace(/\D/g, '')}`} 
                        className="btn btn-primary mobile-only-call" 
                        style={{ 
                          padding: '6px 14px', 
                          height: 'auto', 
                          borderRadius: '24px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '6px', 
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          background: 'linear-gradient(135deg, var(--primary), var(--violet))',
                          boxShadow: '0 4px 14px rgba(124, 58, 237, 0.3)',
                          border: 'none',
                          color: '#fff',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }} 
                        title="Call this number"
                      >
                        <PhoneCall size={13} style={{ fill: 'rgba(255,255,255,0.2)' }} /> Call
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Disposition panel */}
        <div className="glass-panel" style={{ padding: 'var(--card-p)' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <LayoutPanelLeft size={16} style={{ color: 'var(--primary)' }} /> Disposition
          </h2>

          {/* Outcome pills */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
            {DISPS.map(d => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDispForm(p => ({ ...p, disposition: p.disposition === d.key ? '' : d.key }))}
                style={{
                  padding: '10px 8px',
                  borderRadius: 'var(--r-md)',
                  border: dispForm.disposition === d.key ? `2px solid ${d.color}` : '1px solid var(--border)',
                  background: dispForm.disposition === d.key ? `${d.color}18` : 'var(--bg-surface-2)',
                  color: dispForm.disposition === d.key ? d.color : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  transition: 'all var(--t-fast)',
                  fontFamily: 'var(--font)',
                  textAlign: 'center',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleDispose}>
            {dispForm.disposition === 'Appointment' && (
              <div className="input-group">
                <label>Date & Time *</label>
                <input type="datetime-local" className="input-field" value={dispForm.appointmentDt} onChange={e => setDispForm(p => ({ ...p, appointmentDt: e.target.value }))} required />
              </div>
            )}
            {dispForm.disposition === 'Lead' && (
              <>
                <div className="input-group">
                  <label>Lead Amount (₹) *</label>
                  <input type="number" className="input-field" placeholder="Enter deal amount" value={dispForm.leadAmount} onChange={e => setDispForm(p => ({ ...p, leadAmount: e.target.value }))} min="0" step="0.01" required />
                </div>
                <div className="input-group">
                  <label>Other Remarks (Lead Status Details)</label>
                  <input type="text" className="input-field" placeholder="Specify any other status details…" value={dispForm.statusDetails} onChange={e => setDispForm(p => ({ ...p, statusDetails: e.target.value }))} />
                </div>
              </>
            )}
            {dispForm.disposition === 'CallBack' && (
              <div className="input-group">
                <label>Callback Date & Time *</label>
                <input type="datetime-local" className="input-field" value={dispForm.callBackDt} onChange={e => setDispForm(p => ({ ...p, callBackDt: e.target.value }))}
                  min={new Date(Date.now() + 3600000).toISOString().slice(0, 16)} required />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Schedule at least 1 hour from now</small>
              </div>
            )}
            <div className="input-group">
              <label>Remarks</label>
              <textarea className="input-field" rows="4" value={dispForm.remarks} onChange={e => setDispForm(p => ({ ...p, remarks: e.target.value }))} placeholder="Call notes…" />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', height: 48, marginTop: 4 }}
              disabled={!dispForm.disposition || submitting}
            >
              {submitting
                ? <span className="animate-spin" style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block' }} />
                : <><Check size={16} /> Next Contact</>
              }
            </button>
          </form>
        </div>
      </div>

      <style>{`
        .workflow-grid {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: var(--gap);
          align-items: start;
        }
        .contact-detail-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (min-width: 641px) {
          .mobile-only-call { display: none !important; }
        }
        @media (max-width: 1024px) {
          .workflow-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .contact-detail-grid { grid-template-columns: 1fr; gap: 12px; }
        }
      `}</style>
    </div>
  );
};

export default Workflow;
