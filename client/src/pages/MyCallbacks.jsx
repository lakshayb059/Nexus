import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { Phone, Clock, ChevronRight, Bell, User, AlertTriangle, X, Check, Award, Star } from 'lucide-react';

const MyCallbacks = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [callbacks, setCallbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedCb, setSelectedCb] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  const fetchCallbacks = async () => {
    try {
      setLoading(true);
      const res = await api.get('/leads/callbacks');
      // Sort chronologically. Urgent/No-date callbacks go first.
      const sorted = (res.data || []).sort((a, b) => {
        if (!a.callBackDt && !b.callBackDt) return 0;
        if (!a.callBackDt) return -1;
        if (!b.callBackDt) return 1;
        return new Date(a.callBackDt) - new Date(b.callBackDt);
      });
      setCallbacks(sorted);
    } catch (err) {
      console.error('Fetch callbacks failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCallbacks(); }, []);

  const handleContactNow = async (cb) => {
    const cbTime = new Date(cb.callBackDt).getTime();
    const now = new Date().getTime();
    const targetId = cb.contactId || cb._id;

    if (now >= cbTime) {
      // Time has passed -> auto requeue and navigate
      try {
        await api.post(`/contacts/${targetId}/requeue`);
        navigate(`/workflow?contactId=${targetId}`);
      } catch (err) {
        alert('Failed to add to workflow queue');
      }
    } else {
      // Time in the future -> show modal
      setSelectedCb(cb);
      setShowModal(true);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this callback record?')) return;
    try {
      await api.delete(`/leads/callbacks/${id}`);
      fetchCallbacks();
      setSelectedIds(prev => prev.filter(i => i !== id));
    } catch (err) {
      alert('Delete failed');
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} selected callbacks?`)) return;
    try {
      await api.post('/leads/callbacks/bulk-delete', { ids: selectedIds });
      setSelectedIds([]);
      fetchCallbacks();
    } catch (err) {
      alert('Bulk delete failed');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === callbacks.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(callbacks.map(c => c._id));
    }
  };

  const confirmContactNow = async () => {
    if (!selectedCb) return;
    const targetId = selectedCb.contactId || selectedCb._id;
    try {
      await api.post(`/contacts/${targetId}/requeue`);
      setShowModal(false);
      // Removed from list because backend deletes the record
      setCallbacks(prev => prev.filter(c => c._id !== selectedCb._id));
      setSelectedIds(prev => prev.filter(i => i !== selectedCb._id));
      navigate(`/workflow?contactId=${targetId}`);
    } catch (err) {
      alert('Failed to add to workflow queue');
    }
  };

  const handleBulkRequeue = async () => {
    if (!window.confirm(`Add ${selectedIds.length} selected contacts to workflow?`)) return;
    try {
      // Map selected IDs to contact IDs
      const targetContactIds = callbacks
        .filter(c => selectedIds.includes(c._id))
        .map(c => c.contactId || c._id);

      await api.post('/contacts/bulk-requeue', { ids: targetContactIds });
      // Remove from list
      setCallbacks(prev => prev.filter(c => !selectedIds.includes(c._id)));
      setSelectedIds([]);
      alert('Successfully added to workflow');
    } catch (err) {
      alert('Bulk re-queue failed');
    }
  };

  const isToday = (dateStr) => {
    if (!dateStr) return true; // Treat null/requeued as due today
    return new Date(dateStr).toDateString() === new Date().toDateString();
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return 'In Queue';
    return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatMonthDay = (dateStr) => {
    if (!dateStr) {
      return { month: 'DUE', day: 'NOW', time: 'In Queue' };
    }
    const d = new Date(dateStr);
    return {
      month: d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(),
      day: d.getDate(),
      time: formatTime(dateStr),
    };
  };

  const renderList = (list, emptyMessage) => {
    if (list.length === 0) {
      return (
        <div className="glass-panel" style={{ padding: '40px 20px', textAlign: 'center', marginBottom: 20 }}>
          <Clock size={40} style={{ opacity: 0.08, margin: '0 auto 16px', display: 'block' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 30 }}>
        {list.map(cb => {
          const fields = cb.fields || {};
          const name = fields.Name || fields.name || 'Unknown Client';
          const phone = fields.Phone || fields.phone || fields.Mobile || 'N/A';
          const today = isToday(cb.callBackDt);
          const { month, day, time } = formatMonthDay(cb.callBackDt);

          return (
            <div key={cb._id} className="glass-panel appt-card" style={{ border: today ? '1px solid var(--primary)' : undefined }}>
              {/* Date sidebar */}
              <div className="appt-date-col" style={{ background: today ? 'linear-gradient(160deg, var(--primary), var(--violet))' : 'var(--bg-surface-2)', color: today ? '#fff' : 'var(--text-primary)' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: today ? 0.85 : 0.6 }}>{today ? 'TODAY' : month}</div>
                <div style={{ fontSize: '2rem', fontWeight: 900, lineHeight: 1.1 }}>{day}</div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: 2, opacity: 0.9 }}>{time}</div>
                {user?.role === 'admin' && (
                  <input type="checkbox" checked={selectedIds.includes(cb._id)} onChange={() => toggleSelect(cb._id)} onClick={e => e.stopPropagation()} style={{ marginTop: 12, width: 18, height: 18, cursor: 'pointer' }} />
                )}
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
                    {cb.agentName && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><User size={13} /> {cb.agentName}</span>}
                  </div>

                  {cb.remarks && (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-surface-2)', borderRadius: 'var(--r-sm)', borderLeft: '3px solid var(--primary)', fontSize: '0.8rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {cb.remarks.split(' | ').map((remark, idx) => (
                          <div key={idx} style={{ 
                            color: idx === 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                            fontStyle: 'italic',
                            opacity: idx === 0 ? 1 : 0.8,
                            paddingLeft: idx === 0 ? 0 : 10,
                            borderLeft: idx === 0 ? 'none' : '1px solid var(--border)'
                          }}>
                            {remark.startsWith('[Later CB Remark:') ? (
                              <span>
                                <Clock size={10} style={{ display: 'inline', marginRight: 4, opacity: 0.6 }} />
                                {remark.replace('[Later CB Remark:', '').replace(']', '')}
                              </span>
                            ) : remark}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="badge" style={{ 
                      backgroundColor: cb.source === 'lead' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(6, 182, 212, 0.15)', 
                      color: cb.source === 'lead' ? '#10b981' : '#06b6d4', 
                      fontSize: '0.7rem',
                      fontWeight: 600
                    }}>
                      {cb.source === 'lead' ? 'Leads Follow Up' : 'Workflow Follow Up'}
                    </span>
                    {cb.disposition === 'Lead' && (
                      <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Award size={12} /> Lead: ₹{cb.leadAmount?.toLocaleString()}
                      </span>
                    )}
                    {cb.status && (
                      <span className="badge" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', fontSize: '0.7rem' }}>
                        Status: {cb.status}
                      </span>
                    )}
                    {today && <span className="badge badge-primary" style={{ fontSize: '0.7rem' }}>Callback Due Today</span>}
                  </div>
                </div>

                {user?.role === 'agent' && (
                  <button className="btn btn-primary appt-action-btn" onClick={() => handleContactNow(cb)} style={{ padding: '10px 20px', flexShrink: 0 }}>
                    <span className="hide-mobile">Add to Workflow</span>
                    <ChevronRight size={16} />
                  </button>
                )}
                {user?.role === 'admin' && (
                  <button className="btn btn-danger appt-action-btn" onClick={() => handleDelete(cb._id)} style={{ padding: '10px 20px', flexShrink: 0 }}>
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>
            <Clock size={24} style={{ color: 'var(--primary)' }} /> Follow Ups
          </h1>
          <p className="page-subtitle">Your scheduled follow-up calls with potential leads</p>
        </div>
        <span className="badge badge-primary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
          {callbacks.length} Scheduled
        </span>
      </div>

      {callbacks.length > 0 && (
        <div className="glass-panel" style={{ padding: '12px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 'var(--r-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="checkbox"
              checked={selectedIds.length === callbacks.length && callbacks.length > 0}
              onChange={toggleSelectAll}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
              {selectedIds.length > 0 ? `${selectedIds.length} Selected` : 'Select All'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {selectedIds.length > 0 && (
              <>
                <button className="btn btn-primary" onClick={handleBulkRequeue} style={{ padding: '8px 16px', fontSize: '0.8rem' }}>
                  <Check size={14} /> Add to Workflow
                </button>
                {user?.role === 'admin' && (
                  <button className="btn btn-danger" onClick={handleBulkDelete} style={{ padding: '8px 16px', fontSize: '0.8rem' }}>
                    <X size={14} /> Bulk Delete
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

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
      ) : (
        <>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="var(--primary)" /> Scheduled Callbacks
            <span className="badge" style={{ fontSize: '0.75rem', background: 'var(--bg-surface-2)', color: 'var(--text-muted)' }}>{callbacks.length}</span>
          </h2>
          {renderList(callbacks, 'No scheduled follow-up callbacks.')}
        </>
      )}

      {/* Confirmation Modal */}
      {showModal && selectedCb && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
          <div className="glass-panel animate-fade-up" style={{ maxWidth: 450, padding: '30px 24px', textAlign: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: '#f59e0b20', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <AlertTriangle size={32} />
            </div>
            <h3 style={{ marginBottom: 12, color: '#f59e0b' }}>Callback Time Validation</h3>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 24, lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{selectedCb?.fields?.Name || selectedCb?.fields?.name || 'This lead'}</strong> has a callback scheduled for:
              <br /><br />
              <div style={{ backgroundColor: 'var(--bg-surface-2)', padding: '12px', borderRadius: '8px', margin: '12px 0', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>
                  {new Date(selectedCb.callBackDt).toLocaleString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>
              The callback time has not yet arrived. Do you want to add this contact back to your workflow queue anyway?
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

export default MyCallbacks;
