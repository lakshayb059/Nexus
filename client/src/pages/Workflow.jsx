import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useLocation } from 'react-router-dom';
import api from '../utils/api';
import {
  PhoneCall, Check, Clock, Database, CheckCircle2,
  LayoutPanelLeft, RotateCw, X, Calendar, ArrowRight,
  TrendingUp, RefreshCw, AlertCircle, Phone, MessageCircle
} from 'lucide-react';
import WhatsAppIcon from '../components/WhatsAppIcon';

const DISPS = [
  { key: 'Lead', label: 'Lead', color: '#10b981', badgeClass: 'badge-success' },
  { key: 'Appointment', label: 'Appointment', color: '#8b5cf6', badgeClass: 'badge-violet' },
  { key: 'CallNotAnswered', label: 'Call Not Answered', color: '#f59e0b', badgeClass: 'badge-warning' },
  { key: 'HungUp', label: 'Hung Up', color: '#f43f5e', badgeClass: 'badge-danger' },
  { key: 'Invalid', label: 'Invalid / Wrong No.', color: '#ef4444', badgeClass: 'badge-danger' },
  { key: 'DoNotCall', label: 'Do Not Call', color: '#ef4444', badgeClass: 'badge-danger' },
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
    const now = new Date();
    if (dispForm.disposition === 'Lead') {
      if (!dispForm.leadAmount) { alert('Amount is required'); return; }
      if (!dispForm.status) { alert('Lead Status is required'); return; }
    } else if (dispForm.disposition === 'Appointment') {
      if (!dispForm.appointmentDt) { alert('Appointment date is required'); return; }
      if (new Date(dispForm.appointmentDt) < now) { alert('Appointment cannot be scheduled for a past date/time'); return; }
    } else if (dispForm.disposition === 'CallBack') {
      if (!dispForm.callBackDt) { alert('Callback date is required'); return; }
      if (new Date(dispForm.callBackDt) < now) { alert('Callback cannot be scheduled for a past date/time'); return; }
    }

    const remarkWords = dispForm.remarks.trim().split(/\s+/).filter(w => w.length > 0);
    if (remarkWords.length < 1) {
      alert('Remarks are mandatory (min 1 word)'); return;
    }

    setSubmitting(true);
    try {
      let payload = { ...dispForm };

      // Convert local date strings to ISO strings
      if (payload.appointmentDt) {
        payload.appointmentDt = new Date(payload.appointmentDt).toISOString();
      }
      if (payload.callBackDt) {
        payload.callBackDt = new Date(payload.callBackDt).toISOString();
      }

      // Check for existing callback if disposition is CallBack
      if (payload.disposition === 'CallBack') {
        const checkRes = await api.get(`/contacts/${data.contact._id}/check-callback`);
        if (checkRes.data.exists) {
          const existing = checkRes.data.callback;
          const choice = window.confirm(
            `A callback already exists for this contact scheduled for ${new Date(existing.callBackDt).toLocaleString()}.\n\n` +
            `Click OK to EDIT the existing callback with your new date and remarks.\n` +
            `Click CANCEL to CREATE A NEW separate callback record.`
          );

          if (choice) {
            // EDIT existing
            await api.put(`/leads/callbacks/${existing._id}`, {
              callBackDt: payload.callBackDt,
              remarks: payload.remarks
            });
            alert('Existing callback updated successfully!');
            setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', status: '', statusDetails: '', transactionId: '' });
            fetchNext();
            return;
          }
          // If Cancel, it continues to standard post /dispose (Create New)
        }
      }

      await api.post(`/contacts/${data.contact._id}/dispose`, payload);
      setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', status: '', statusDetails: '', transactionId: '' });
      fetchNext();
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.error === 'EXISTING_LEAD') {
        const targetSection = dispForm.status === 'Call Back' ? 'Callback' : 'Appointment';
        const confirmRedirect = window.confirm(
          `A lead record already exists for this contact.\n\nWould you like to save this update in the ${targetSection} section instead?`
        );

        if (confirmRedirect) {
          // Change disposition based on the status and retry
          let retryPayload = { ...dispForm };
          if (retryPayload.status === 'Call Back') {
            retryPayload.disposition = 'CallBack';
          } else {
            retryPayload.disposition = 'Appointment';
            if (!retryPayload.appointmentDt) retryPayload.appointmentDt = retryPayload.callBackDt || new Date().toISOString();
          }

          // Format dates for retry
          if (retryPayload.appointmentDt) retryPayload.appointmentDt = new Date(retryPayload.appointmentDt).toISOString();
          if (retryPayload.callBackDt) retryPayload.callBackDt = new Date(retryPayload.callBackDt).toISOString();

          try {
            await api.post(`/contacts/${data.contact._id}/dispose`, retryPayload);
            setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', status: '', statusDetails: '', transactionId: '' });
            fetchNext();
            return;
          } catch (retryErr) {
            alert('Failed to save redirected task');
          }
        }
      } else {
        alert(err.response?.data?.error || 'Disposition failed');
      }
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
  const progressPercent = total > 0 ? Math.round(((total - (data?.pending || 0)) / total) * 100) : 0;

  if (!data?.contact) {
    const getDeduplicated = (contacts, type, dateField) => {
      const map = new Map();
      contacts.filter(c => c.disposition === type).forEach(c => {
        const phone = c.fields?.Phone || c.fields?.phone || c.fields?.Mobile || c._id;
        if (!map.has(phone) || new Date(c[dateField]) < new Date(map.get(phone)[dateField])) {
          map.set(phone, c);
        }
      });
      return Array.from(map.values());
    };

    const appts = getDeduplicated(emptyStateContacts || [], 'Appointment', 'appointmentDt');
    const cbs = getDeduplicated(emptyStateContacts || [], 'CallBack', 'callBackDt');

    return (
      <div className="animate-fade-in">
        <div className="glass-panel" style={{ padding: 'clamp(30px, 8vw, 60px)', textAlign: 'center', maxWidth: 800, margin: '20px auto', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, background: 'var(--border)' }}>
            <div style={{ width: '100%', height: '100%', background: 'var(--success)', transition: 'width 1s ease' }} />
          </div>
          <CheckCircle2 size={56} style={{ color: 'var(--success)', marginBottom: 20 }} />
          <h2 style={{ fontSize: 'clamp(1.5rem, 5vw, 2.2rem)', fontWeight: 900, color: 'var(--text-primary)' }}>Queue Complete!</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: 24 }}>You've successfully processed all assigned contacts. Great job!</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
            <div className="badge badge-primary" style={{ padding: '8px 16px' }}><strong>{total}</strong> Total</div>
            <div className="badge badge-success" style={{ padding: '8px 16px' }}><strong>{disposed}</strong> Disposed</div>
          </div>
          <button className="btn btn-primary" onClick={() => fetchNext()} style={{ padding: '12px 24px' }}>
            <RotateCw size={16} /> Refresh Queue
          </button>
        </div>

        <div className="grid-2" style={{ marginTop: 32 }}>
          <div className="glass-panel" style={{ padding: 'var(--card-p)', borderTop: '4px solid var(--violet)' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--violet)', marginBottom: 16, fontSize: '1rem' }}>
              <Calendar size={18} /> Appointments <span className="badge badge-violet">{appts.length}</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {appts.map(c => (
                <div key={c._id} style={{ padding: 12, background: 'var(--bg-surface-2)', borderRadius: 'var(--r-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{c.fields?.Name || 'Unknown'}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(c.appointmentDt).toLocaleString()}</div>
                  </div>
                  <button className="btn btn-primary btn-icon" onClick={() => handleRequeue(c._id)} disabled={requeuing === c._id} style={{ width: 28, height: 28 }}>
                    <ArrowRight size={14} />
                  </button>
                </div>
              ))}
              {appts.length === 0 && <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No appointments.</div>}
            </div>
          </div>
          <div className="glass-panel" style={{ padding: 'var(--card-p)', borderTop: '4px solid var(--cyan)' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--cyan)', marginBottom: 16, fontSize: '1rem' }}>
              <Clock size={18} /> Callbacks <span className="badge badge-cyan">{cbs.length}</span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cbs.map(c => (
                <div key={c._id} style={{ padding: 12, background: 'var(--bg-surface-2)', borderRadius: 'var(--r-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{c.fields?.Name || 'Unknown'}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(c.callBackDt).toLocaleString()}</div>
                  </div>
                  <button className="btn btn-primary btn-icon" onClick={() => handleRequeue(c._id)} disabled={requeuing === c._id} style={{ width: 28, height: 28 }}>
                    <ArrowRight size={14} />
                  </button>
                </div>
              ))}
              {cbs.length === 0 && <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No callbacks.</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { contact, remaining, rechurnNum, type } = data;
  const fields = contact.fields || {};

  return (
    <div className="animate-reveal">
      {/* Dynamic Progress Header */}
      <div className="workflow-header" style={{ marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: 'var(--h1)', fontWeight: 900, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <PhoneCall size={20} color="var(--primary)" /> Calling Queue
              </h1>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--primary)' }}>{progressPercent}% Complete</span>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{disposed} / {total} Contacts</div>
            </div>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>

      <div className="workflow-grid" style={{ marginTop: 24 }}>
        {/* Contact Info Card */}
        <div className="glass-panel" style={{ padding: 'var(--card-p)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{fields.Name || 'Contact'} Info</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {type === 'rechurn' && (
                <div className="badge badge-warning">
                  <RefreshCw size={12} className="animate-spin" /> {rechurnNum}/3 Attempt
                </div>
              )}
              {type === 'callback_due' && <div className="badge badge-cyan">Callback Due</div>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {Object.entries(fields).map(([k, v]) => {
              const isPhone = k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile');
              return (
                <div key={k} style={{ padding: 12, background: 'var(--bg-surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em', marginBottom: 2 }}>{k}</span>
                      <span style={{ display: 'block', fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{String(v) || '—'}</span>
                    </div>
                    {isPhone && v && (
                      <div style={{ display: 'flex', gap: 6, marginLeft: 10, flexShrink: 0 }}>
                        <a href={`https://wa.me/${String(v).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" style={{ width: 34, height: 34, borderRadius: 10, background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }} title="Message on WhatsApp">
                          <WhatsAppIcon size={16} fill="currentColor" />
                        </a>
                        <a href={`tel:${v}`} style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }} title="Call Customer">
                          <Phone size={16} fill="currentColor" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {(() => {
            const parseRemark = (remarkStr) => {
              const requeueRegex = /^\[Requeued by (.+?) on (.+?)\]$/;
              const standardRegex = /^\[(.+?) by (.+?) on (.+?)\]:\s*(.*)$/;
              const cbRegex = /^\[Later CB Remark:\s*(.*)\]$/;
              const oldRequeueRegex = /^Requeued by (.+)$/;

              if (requeueRegex.test(remarkStr)) {
                const [_, name, date] = remarkStr.match(requeueRegex);
                return { type: 'requeue', label: 'Requeued', agent: name, date, content: 'Contact was returned to the active calling queue.' };
              }
              if (standardRegex.test(remarkStr)) {
                const [_, disposal, agent, date, content] = remarkStr.match(standardRegex);
                return { type: 'disposal', label: disposal, agent, date, content };
              }
              if (cbRegex.test(remarkStr)) {
                const [_, content] = remarkStr.match(cbRegex);
                return { type: 'callback', label: 'Callback', content };
              }
              if (oldRequeueRegex.test(remarkStr)) {
                const [_, name] = remarkStr.match(oldRequeueRegex);
                return { type: 'requeue', label: 'Requeued', agent: name, content: 'Contact was returned to the active calling queue.' };
              }
              return { type: 'legacy', content: remarkStr };
            };

            const getEntryMeta = (type, label) => {
              const normLabel = (label || '').toLowerCase();
              if (normLabel.includes('lead')) return { color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)', border: '#10b981' };
              if (normLabel.includes('appointment')) return { color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.1)', border: '#8b5cf6' };
              if (normLabel.includes('not answered')) return { color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)', border: '#f59e0b' };
              if (normLabel.includes('hung up')) return { color: '#f43f5e', bgColor: 'rgba(244, 63, 94, 0.1)', border: '#f43f5e' };
              if (normLabel.includes('invalid') || normLabel.includes('wrong')) return { color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)', border: '#ef4444' };
              if (normLabel.includes('do not call') || normLabel.includes('dnc')) return { color: '#b91c1c', bgColor: 'rgba(185, 28, 28, 0.1)', border: '#b91c1c' };
              if (normLabel.includes('call back')) return { color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.1)', border: '#06b6d4' };
              if (normLabel.includes('requeued')) return { color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.1)', border: '#3b82f6' };
              if (normLabel.includes('callback')) return { color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.1)', border: '#06b6d4' };
              
              if (normLabel.includes('status:')) return { color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.1)', border: '#8b5cf6' };

              return { color: 'var(--primary)', bgColor: 'rgba(99, 102, 241, 0.1)', border: 'var(--primary)' };
            };

            if (!contact.remarks) return null;

            return (
              <div style={{ marginTop: 24, padding: '20px 24px 24px', background: 'var(--bg-surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 900, letterSpacing: '0.08em', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrendingUp size={14} color="var(--primary)" /> Customer 360
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', paddingLeft: 18, borderLeft: '2px solid var(--border)' }}>
                  {contact.remarks.split(' | ').reverse().map((remarkStr, idx, arr) => {
                    const entry = parseRemark(remarkStr);
                    const meta = getEntryMeta(entry.type, entry.label);
                    
                    return (
                      <div key={idx} style={{ position: 'relative', marginBottom: idx === arr.length - 1 ? 0 : 20 }}>
                        {/* Timeline indicator node */}
                        <div style={{ 
                          position: 'absolute', 
                          left: -27, 
                          top: 2, 
                          width: 16, 
                          height: 16, 
                          borderRadius: '50%', 
                          background: 'var(--bg-surface-2)', 
                          border: `3px solid ${meta.color}`,
                          boxShadow: 'var(--shadow-sm)'
                        }} />
                        
                        {/* Entry Header */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          {entry.label ? (
                            <span style={{ 
                              fontSize: '0.68rem', 
                              fontWeight: 800, 
                              color: meta.color, 
                              background: meta.bgColor, 
                              border: `1px solid ${meta.border}`,
                              padding: '2px 8px', 
                              borderRadius: '20px', 
                              textTransform: 'uppercase',
                              letterSpacing: '0.02em'
                            }}>
                              {entry.label}
                            </span>
                          ) : (
                            <span style={{ 
                              fontSize: '0.68rem', 
                              fontWeight: 800, 
                              color: 'var(--text-muted)', 
                              background: 'var(--bg-surface-1)', 
                              border: '1px solid var(--border)',
                              padding: '2px 8px', 
                              borderRadius: '20px', 
                              textTransform: 'uppercase',
                              letterSpacing: '0.02em'
                            }}>
                              Remark
                            </span>
                          )}
                          {entry.agent && (
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                              by <strong style={{ color: 'var(--primary)' }}>{entry.agent}</strong>
                            </span>
                          )}
                          {entry.date && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              on {entry.date}
                            </span>
                          )}
                        </div>
                        
                        {/* Entry Content (Remarks Text) */}
                        {entry.content && (
                          <div style={{ 
                            fontSize: '0.88rem', 
                            color: 'var(--text-primary)', 
                            fontStyle: entry.type === 'legacy' ? 'normal' : 'italic', 
                            lineHeight: 1.45,
                            background: 'var(--bg-surface-1)',
                            padding: '8px 12px',
                            borderRadius: 'var(--r-md)',
                            borderLeft: `3px solid ${meta.color}`,
                            wordBreak: 'break-word'
                          }}>
                            {entry.content}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Prominent Call Bar for Mobile Only */}
          {(() => {
            const phoneEntry = Object.entries(fields).find(([k, v]) => (k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile')) && v);
            if (phoneEntry) {
              return (
                <a href={`tel:${phoneEntry[1]}`} className="mobile-call-bar">
                  <div className="pulse-white">
                    <Phone size={22} fill="currentColor" />
                  </div>
                  <span>CALL CUSTOMER NOW</span>
                </a>
              );
            }
          })()}

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
                <div className="input-group">
                  <label htmlFor="leadAmount">Lead Amount (₹)</label>
                  <input id="leadAmount" name="leadAmount" type="number" className="input-field" value={dispForm.leadAmount} onChange={e => setDispForm(p => ({ ...p, leadAmount: e.target.value }))} required />
                </div>
                <div className="input-group">
                  <label htmlFor="leadStatus">Lead Status</label>
                  <select id="leadStatus" name="leadStatus" className="input-field" value={dispForm.status} onChange={e => setDispForm(p => ({ ...p, status: e.target.value }))} required>
                    <option value="">Select Status...</option>
                    {LEAD_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                {dispForm.status === 'Converted' && (
                  <div className="input-group">
                    <label htmlFor="transactionId">Transaction ID / UTR</label>
                    <input id="transactionId" name="transactionId" type="text" className="input-field" value={dispForm.transactionId} onChange={e => setDispForm(p => ({ ...p, transactionId: e.target.value }))} required />
                  </div>
                )}
                {dispForm.status === 'Call Back' && (
                  <div className="input-group">
                    <label htmlFor="leadCallBackDt">Callback Schedule</label>
                    <input id="leadCallBackDt" name="callBackDt" type="datetime-local" className="input-field" value={dispForm.callBackDt} min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={e => setDispForm(p => ({ ...p, callBackDt: e.target.value }))} required />
                  </div>
                )}
              </div>
            )}

            {dispForm.disposition === 'Appointment' && (
              <div className="input-group animate-slide-up">
                <label htmlFor="appointmentDt">Appointment Date & Time</label>
                <input id="appointmentDt" name="appointmentDt" type="datetime-local" className="input-field" value={dispForm.appointmentDt} min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={e => setDispForm(p => ({ ...p, appointmentDt: e.target.value }))} required />
              </div>
            )}

            {dispForm.disposition === 'CallBack' && (
              <div className="input-group animate-slide-up">
                <label htmlFor="callBackDt">Callback Date & Time</label>
                <input id="callBackDt" name="callBackDt" type="datetime-local" className="input-field" value={dispForm.callBackDt} min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={e => setDispForm(p => ({ ...p, callBackDt: e.target.value }))} required />
              </div>
            )}

            <div className="input-group">
              <label htmlFor="remarks">Remarks (Min 1 word) *</label>
              <textarea id="remarks" name="remarks" className="input-field" rows="3" value={dispForm.remarks} onChange={e => setDispForm(p => ({ ...p, remarks: e.target.value }))} required placeholder="Enter call notes here..." />
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
        .detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; margin-top: 10px; }
        .detail-item { padding: 16px; background: #f8fafc; border-radius: 16px; border: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
        .detail-label { display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; margin-bottom: 2px; }
        .detail-value { font-size: 1.1rem; font-weight: 800; color: #1e293b; word-break: break-all; }

        .call-action-btn { display: none; } /* Hidden on desktop */
        
        .mobile-call-bar { display: none; } /* Hidden on desktop */

        @media (max-width: 640px) {
          .call-action-btn { 
            width: 42px; height: 42px; border-radius: 12px; background: #10b981; color: #fff; 
            display: flex; align-items: center; justify-content: center; text-decoration: none;
            box-shadow: 0 4px 10px rgba(16, 185, 129, 0.2);
          }
          
          .mobile-call-bar { 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            gap: 12px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: #fff;
            padding: 18px;
            border-radius: 18px;
            text-decoration: none;
            font-weight: 900;
            font-size: 1rem;
            letter-spacing: 0.02em;
            margin-top: 24px;
            box-shadow: 0 10px 25px rgba(16, 185, 129, 0.4);
            transition: transform 0.2s;
          }
          .mobile-call-bar:active { transform: scale(0.98); }
          
          .pulse-white {
            animation: pulse-white 2s infinite;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        }

        @keyframes pulse-white {
          0% { transform: scale(0.95); opacity: 1; }
          70% { transform: scale(1.1); opacity: 0.8; }
          100% { transform: scale(0.95); opacity: 1; }
        }

        .dispo-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .dispo-btn { 
          padding: 14px; border-radius: 14px; border: 1px solid #e2e8f0; background: #fff; 
          color: #64748b; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;
        }
        .dispo-btn:hover { border-color: var(--btn-color); background: #f8fafc; }
        .dispo-btn.active { background: var(--btn-color); color: #fff; border-color: var(--btn-color); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }

        .submit-btn { width: 100%; height: 56px; border-radius: 16px; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 1.1rem; font-weight: 800; }
        
        @media (max-width: 1024px) { 
          .workflow-grid { grid-template-columns: 1fr; } 
          .detail-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
};

export default Workflow;
