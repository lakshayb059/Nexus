import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { Calendar, Clock, Phone, ChevronRight, Bell, User, AlertTriangle, X, Check } from 'lucide-react';

const MyAppointments = () => {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showModal,    setShowModal]    = useState(false);
  const [selectedApp,  setSelectedApp]  = useState(null);

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const res = await api.get('/leads/appointments');
      setAppointments(res.data);
    } catch (err) {
      console.error('Fetch appointments failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAppointments(); }, []);

  const handleContactNow = async (app) => {
    const appTime = new Date(app.appointmentDt).getTime();
    const now = new Date().getTime();

    if (now >= appTime) {
      // Time has passed -> auto requeue and navigate
      try {
        await api.post(`/contacts/${app._id}/requeue`);
        navigate(`/workflow?contactId=${app._id}`);
      } catch (err) {
        alert('Failed to add to workflow queue');
      }
    } else {
      // Time in the future -> show modal
      setSelectedApp(app);
      setShowModal(true);
    }
  };

  const confirmContactNow = async () => {
    if (!selectedApp) return;
    try {
      await api.post(`/contacts/${selectedApp._id}/requeue`);
      setShowModal(false);
      navigate(`/workflow?contactId=${selectedApp._id}`);
    } catch (err) {
      alert('Failed to add to workflow queue');
    }
  };

  const isToday = (dateStr) =>
    new Date(dateStr).toDateString() === new Date().toDateString();

  const formatTime = (dateStr) =>
    new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const formatMonthDay = (dateStr) => {
    const d = new Date(dateStr);
    return {
      month: d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(),
      day:   d.getDate(),
      time:  formatTime(dateStr),
    };
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>
            <Calendar size={24} style={{ color: 'var(--primary)' }} /> My Appointments
          </h1>
          <p className="page-subtitle">Your scheduled callbacks and meetings with potential leads</p>
        </div>
        <span className="badge badge-primary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
          {appointments.length} Scheduled
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-panel" style={{ display: 'flex', overflow: 'hidden', borderRadius: 'var(--r-lg)' }}>
              <div className="skeleton" style={{ width: 110, flexShrink: 0, borderRadius: 0 }} />
              <div style={{ flex: 1, padding: 'var(--card-p)' }}>
                <div className="skeleton" style={{ height: 16, width: '40%', marginBottom: 12 }} />
                <div className="skeleton" style={{ height: 12, width: '60%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="glass-panel" style={{ padding: '80px 40px', textAlign: 'center' }}>
          <Calendar size={64} style={{ opacity: 0.08, margin: '0 auto 20px', display: 'block' }} />
          <h3 style={{ marginBottom: 8 }}>No upcoming appointments</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Schedule appointments during your workflow to see them here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {appointments.map(app => {
            const fields  = app.fields || {};
            const name    = fields.Name || fields.name || 'Unknown Client';
            const phone   = fields.Phone || fields.phone || fields.Mobile || 'N/A';
            const today   = isToday(app.appointmentDt);
            const { month, day, time } = formatMonthDay(app.appointmentDt);

            return (
              <div
                key={app._id}
                className="glass-panel appt-card"
                style={{ border: today ? '1px solid var(--primary)' : undefined }}
              >
                {/* Date sidebar */}
                <div
                  className="appt-date-col"
                  style={{
                    background: today
                      ? 'linear-gradient(160deg, var(--primary), var(--violet))'
                      : 'var(--bg-surface-2)',
                    color: today ? '#fff' : 'var(--text-primary)',
                  }}
                >
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: today ? 0.85 : 0.6 }}>
                    {today ? 'TODAY' : month}
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 900, lineHeight: 1.1 }}>{day}</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: 2, opacity: 0.9 }}>{time}</div>
                </div>

                {/* Content */}
                <div className="appt-content">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                      {today && <Bell size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} className="animate-bounce" />}
                    </h3>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={13} /> {phone}</span>
                      {app.agentName && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><User size={13} /> {app.agentName}</span>
                      )}
                      {app.remarks && (
                        <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>"{app.remarks}"</span>
                      )}
                    </div>
                    {today && (
                      <div style={{ marginTop: 10 }}>
                        <span className="badge badge-primary" style={{ fontSize: '0.7rem' }}>
                          Appointment Today
                        </span>
                      </div>
                    )}
                  </div>

                  <button className="btn btn-primary appt-action-btn" onClick={() => handleContactNow(app)} style={{ padding: '10px 20px', flexShrink: 0 }}>
                    <span className="hide-mobile">Contact Now</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal */}
      {showModal && selectedApp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
          <div className="glass-panel animate-fade-up" style={{ maxWidth: 450, padding: '30px 24px', textAlign: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: '#f59e0b20', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <AlertTriangle size={32} />
            </div>
            <h3 style={{ marginBottom: 12, color: '#f59e0b' }}>Appointment Time Validation</h3>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 24, lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{selectedApp?.fields?.Name || selectedApp?.fields?.name || 'This lead'}</strong> has an appointment scheduled for:
              <br/><br/>
              <div style={{ backgroundColor: 'var(--bg-surface-2)', padding: '12px', borderRadius: '8px', margin: '12px 0', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>
                  {new Date(selectedApp.appointmentDt).toLocaleString('en-IN', { 
                    weekday: 'short',
                    day: 'numeric', 
                    month: 'short', 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </div>
              </div>
              The appointment time has not yet arrived. Do you want to add this contact back to your workflow queue anyway?
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)}>
                <X size={16} /> No, Cancel
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmContactNow}>
                <Check size={16} /> Yes, Add to Workflow
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .appt-card {
          display: flex;
          overflow: hidden;
          transition: transform var(--t-base), box-shadow var(--t-base);
          padding: 0;
        }
        .appt-card:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(0,0,0,0.35); }
        .appt-date-col {
          width: 110px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 20px 12px;
          flex-shrink: 0;
          text-align: center;
        }
        .appt-content {
          flex: 1;
          padding: var(--card-p);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          min-width: 0;
        }
        @media (max-width: 640px) {
          .appt-card { flex-direction: column; }
          .appt-date-col {
            width: 100%;
            flex-direction: row;
            gap: 16px;
            padding: 12px 18px;
            justify-content: flex-start;
          }
          .appt-content { flex-direction: column; align-items: stretch; }
          .appt-action-btn { width: 100%; justify-content: center; }
        }
      `}</style>
    </div>
  );
};

export default MyAppointments;
