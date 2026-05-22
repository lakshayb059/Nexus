import React, { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { 
  Phone, X, Check, Clock, Calendar, AlertCircle, RotateCw, PhoneCall
} from 'lucide-react';

const DISPS = [
  { key: 'Lead', label: 'Lead', color: '#10b981' },
  { key: 'Appointment', label: 'Appointment', color: '#8b5cf6' },
  { key: 'CallNotAnswered', label: 'Call Not Answered', color: '#f59e0b' },
  { key: 'HungUp', label: 'Hung Up', color: '#f43f5e' },
  { key: 'Invalid', label: 'Invalid / Wrong No.', color: '#ef4444' },
  { key: 'DoNotCall', label: 'Do Not Call', color: '#64748b' },
  { key: 'CallBack', label: 'Call Back', color: '#06b6d4' },
];

const LEAD_STATUS_OPTIONS = ['Converted', 'Not Interested', 'DNC/DND', 'Call Back', 'Others'];

const DueTaskModal = () => {
  const { socket } = useSocket();
  const { user, isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [taskData, setTaskData] = useState(null);
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dispForm, setDispForm] = useState({ 
    disposition: '', remarks: '', appointmentDt: '', leadAmount: '', 
    callBackDt: '', status: '', statusDetails: '', transactionId: '' 
  });

  useEffect(() => {
    if (!socket || !isAuthenticated || !user) return;

    const handleReminder = async (data) => {
      // Only for the assigned agent
      if (data.agentId !== user._id) return;
      
      // We only care about IMMEDIATE due or LATE tasks for the popup
      if (data.type === 'upcoming' && data.minutesUntil > 2) return;

      try {
        setLoading(true);
        // Fetch full contact details
        const contactId = data.contactId || data.appointmentId;
        const res = await api.get(`/contacts?search=${data.contactName}`); // Search by name as a fallback if ID is missing
        // Better: fetch by ID directly
        const contactRes = await api.get(`/contacts/${contactId}`);
        setContact(contactRes.data);
        setTaskData(data);
        setIsOpen(true);
      } catch (err) {
        console.error('Failed to fetch contact for due task', err);
      } finally {
        setLoading(false);
      }
    };

    socket.on('appointment_reminder', handleReminder);
    socket.on('callback_due', (data) => {
        if (data.agentId !== user._id) return;
        handleReminder({ ...data, type: 'callback' });
    });

    return () => {
      socket.off('appointment_reminder');
      socket.off('callback_due');
    };
  }, [socket, isAuthenticated, user]);

  const handleDispose = async (e) => {
    e.preventDefault();
    if (!contact) return;

    // Validation
    if (dispForm.disposition === 'Lead') {
      if (!dispForm.leadAmount) { alert('Amount is required'); return; }
      if (!dispForm.status) { alert('Lead Status is required'); return; }
    }

    const remarkWords = dispForm.remarks.trim().split(/\s+/).filter(w => w.length > 0);
    if (remarkWords.length < 1) {
      alert('Remarks are mandatory'); return;
    }

    setSubmitting(true);
    try {
      const payload = { ...dispForm };
      // Handle Date conversions
      if (payload.appointmentDt) payload.appointmentDt = new Date(payload.appointmentDt).toISOString();
      if (payload.callBackDt) payload.callBackDt = new Date(payload.callBackDt).toISOString();

      await api.post(`/contacts/${contact._id}/dispose`, payload);
      setIsOpen(false);
      setContact(null);
      setTaskData(null);
      setDispForm({ disposition: '', remarks: '', appointmentDt: '', leadAmount: '', callBackDt: '', status: '', statusDetails: '', transactionId: '' });
      
      // Refresh current page if on workflow
      if (window.location.pathname === '/workflow') {
        window.location.reload();
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Disposition failed');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen || !contact) return null;

  return (
    <div className="due-task-overlay">
      <div className="due-task-modal animate-fade-up">
        <div className="due-task-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="pulse-icon">
              <AlertCircle size={24} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900 }}>PRIORITY TASK DUE</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.8 }}>Action required immediately</p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="close-btn"><X size={20} /></button>
        </div>

        <div className="due-task-body">
          <div className="contact-summary-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: 4 }}>{contact.fields?.Name || contact.fields?.name}</h3>
                <div style={{ display: 'flex', gap: 15, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><PhoneCall size={14} /> {contact.fields?.Phone || contact.fields?.Mobile}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {taskData.type === 'appointment' ? <Calendar size={14} /> : <Clock size={14} />} 
                    Scheduled for {new Date(contact.appointmentDt || contact.callBackDt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
              <a href={`tel:${contact.fields?.Phone || contact.fields?.Mobile}`} className="call-now-btn">
                <Phone size={20} fill="currentColor" />
                Call Now
              </a>
            </div>
          </div>

          <div className="disposal-section">
            <h4 style={{ marginBottom: 15 }}>Submit Disposition</h4>
            <div className="dispo-grid">
              {DISPS.map(d => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setDispForm(p => ({ ...p, disposition: d.key }))}
                  className={`dispo-pill ${dispForm.disposition === d.key ? 'active' : ''}`}
                  style={{ '--pill-color': d.color }}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleDispose} style={{ marginTop: 20 }}>
              {dispForm.disposition === 'Lead' && (
                <div className="form-row animate-slide-up">
                  <div className="input-group">
                    <label htmlFor="dueLeadAmount">Amount (₹)</label>
                    <input id="dueLeadAmount" name="leadAmount" type="number" className="input-field" value={dispForm.leadAmount} onChange={e => setDispForm(p => ({ ...p, leadAmount: e.target.value }))} required />
                  </div>
                  <div className="input-group">
                    <label htmlFor="dueLeadStatus">Lead Status</label>
                    <select id="dueLeadStatus" name="status" className="input-field" value={dispForm.status} onChange={e => setDispForm(p => ({ ...p, status: e.target.value }))} required>
                      <option value="">Select...</option>
                      {LEAD_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {dispForm.disposition === 'Appointment' && (
                <div className="input-group animate-slide-up">
                  <label htmlFor="dueAppointmentDt">New Appointment Date & Time</label>
                  <input id="dueAppointmentDt" name="appointmentDt" type="datetime-local" className="input-field" value={dispForm.appointmentDt} min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={e => setDispForm(p => ({ ...p, appointmentDt: e.target.value }))} required />
                </div>
              )}

              {dispForm.disposition === 'CallBack' && (
                <div className="input-group animate-slide-up">
                  <label htmlFor="dueCallBackDt">New Callback Date & Time</label>
                  <input id="dueCallBackDt" name="callBackDt" type="datetime-local" className="input-field" value={dispForm.callBackDt} min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={e => setDispForm(p => ({ ...p, callBackDt: e.target.value }))} required />
                </div>
              )}

              <div className="input-group">
                <label htmlFor="dueRemarks">Remarks *</label>
                <textarea id="dueRemarks" name="remarks" className="input-field" rows="2" value={dispForm.remarks} onChange={e => setDispForm(p => ({ ...p, remarks: e.target.value }))} required placeholder="Enter final call notes..." />
              </div>

              <button type="submit" className="btn btn-primary submit-btn" disabled={submitting || !dispForm.disposition}>
                {submitting ? <RotateCw className="animate-spin" size={18} /> : <><Check size={18} /> Complete Priority Task</>}
              </button>
            </form>
          </div>
        </div>
      </div>

      <style>{`
        .due-task-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          z-index: 9999;
          padding: 40px 16px;
          overflow-y: auto;
        }
        .due-task-modal {
          background: var(--bg-surface);
          width: 100%;
          max-width: 600px;
          border-radius: 24px;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
          border: 1px solid rgba(255,255,255,0.1);
          margin: 0 auto;
        }
        .due-task-header {
          padding: 20px 24px;
          background: #ef4444;
          color: #fff;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .pulse-icon {
          animation: pulse 1.5s infinite;
          background: rgba(255,255,255,0.2);
          padding: 8px;
          border-radius: 12px;
        }
        @keyframes pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
          70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(255,255,255,0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0); }
        }
        .due-task-body { padding: 24px; }
        .contact-summary-card {
          padding: 20px;
          background: var(--bg-surface-2);
          border-radius: 16px;
          margin-bottom: 24px;
          border: 1px solid var(--border);
        }
        .call-now-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #10b981;
          color: #fff;
          padding: 12px 20px;
          border-radius: 12px;
          text-decoration: none;
          font-weight: 800;
          transition: transform 0.2s;
        }
        .call-now-btn:hover { transform: scale(1.05); }
        .dispo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
        .dispo-pill {
          padding: 10px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg-surface);
          color: var(--text-secondary);
          font-weight: 700;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        .dispo-pill:hover { border-color: var(--pill-color); background: var(--bg-surface-2); }
        .dispo-pill.active { background: var(--pill-color); color: #fff; border-color: var(--pill-color); }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        .close-btn { background: none; border: none; color: #fff; cursor: pointer; opacity: 0.7; transition: opacity 0.2s; }
        .close-btn:hover { opacity: 1; }
        .submit-btn { width: 100%; height: 54px; margin-top: 10px; font-weight: 800; font-size: 1rem; }
      `}</style>
    </div>
  );
};

export default DueTaskModal;
