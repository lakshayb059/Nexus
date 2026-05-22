import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import { PhoneOff, Search, PhoneCall, Calendar, Trash2 } from 'lucide-react';


const HungUp = () => {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const [contacts,   setContacts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch both HungUp and CallNotAnswered
      const [hungUpRes, unansweredRes] = await Promise.all([
        api.get('/contacts?disposition=HungUp'),
        api.get('/contacts?disposition=CallNotAnswered')
      ]);
      
      const all = [...hungUpRes.data, ...unansweredRes.data];
      // Filter only those that have reached the 3-occurrence limit (queueOrder = 999999)
      const permanentlyRemoved = all.filter(c => c.queueOrder === 999999);
      
      // Sort by last modified descending
      permanentlyRemoved.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      
      setContacts(permanentlyRemoved);
    } catch (err) {
      console.error('Fetch failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (!socket) return;
    socket.on('contact_disposed', fetchData);
    socket.on('contacts_updated', fetchData);
    return () => {
      socket.off('contact_disposed', fetchData);
      socket.off('contacts_updated', fetchData);
    };
  }, [socket]);

  const filtered = contacts.filter(c => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return Object.values(c.fields || {}).some(v => String(v).toLowerCase().includes(q)) ||
           (c.agentName && c.agentName.toLowerCase().includes(q));
  });

  const handleWipeHungUp = async () => {
    const confirmation = window.prompt("WARNING: This will delete ALL failed/hung-up contacts. Type 'DELETE' to confirm.");
    if (confirmation === 'DELETE') {
      try {
        await api.delete('/contacts/wipe/hungup');
        fetchData();
        alert('All hung-up contacts have been wiped.');
      } catch (err) {
        alert(err.response?.data?.error || 'Failed to wipe hung-up contacts');
      }
    }
  };



  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>
            <PhoneOff size={24} style={{ color: 'var(--danger)' }} /> Unanswered & Hung Up
          </h1>
          <p className="page-subtitle">Contacts removed from workflow after 3 unsuccessful attempts</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {user?.role === 'superadmin' && (
            <button className="btn btn-danger" onClick={handleWipeHungUp} style={{ fontSize: '0.75rem', padding: '6px 12px' }}>
              <Trash2 size={14} /> Wipe Failed Calls
            </button>
          )}
          <span className="badge badge-danger" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            {filtered.length} Contacts
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="glass-panel" style={{ marginBottom: 'var(--gap)', padding: '12px 18px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" className="input-field" placeholder="Search contacts by name, phone…" style={{ paddingLeft: 42, marginBottom: 0 }}
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
      </div>

      {/* Contact list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-panel" style={{ padding: 'var(--card-p)' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div className="skeleton" style={{ width: 64, height: 64, borderRadius: 'var(--r-md)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 16, width: '40%', marginBottom: 10 }} />
                  <div className="skeleton" style={{ height: 12, width: '60%' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel" style={{ padding: '80px 40px', textAlign: 'center' }}>
          <PhoneOff size={64} style={{ opacity: 0.08, margin: '0 auto 20px', display: 'block' }} />
          <h3 style={{ marginBottom: 8 }}>No failed contacts</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>You don't have any contacts that reached the 3-attempt limit.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filtered.map(contact => {
            const fields = contact.fields || {};
            const name   = fields.Name || fields.name || 'Unknown';
            const phone  = fields.Phone || fields.phone || fields.Mobile || 'N/A';
            const isHungUp = contact.disposition === 'HungUp';
            
            return (
              <div key={contact._id} className="glass-panel contact-list-item" style={{ padding: 'var(--card-p)', borderLeft: `4px solid ${isHungUp ? 'var(--danger)' : 'var(--warning)'}` }}>
                <div className="contact-list-inner">
                  <div style={{ display: 'flex', gap: 18, alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: 'var(--r-md)',
                      background: isHungUp ? 'linear-gradient(135deg, #dc2626, #991b1b)' : 'linear-gradient(135deg, #d97706, #92400e)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', flexShrink: 0,
                      boxShadow: isHungUp ? '0 4px 12px rgba(220,38,38,0.3)' : '0 4px 12px rgba(217,119,6,0.3)',
                    }}>
                      <PhoneOff size={24} fill="white" />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: isHungUp ? 'var(--danger)' : 'var(--warning)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                          {name}
                        </h3>
                        <span className={`badge ${isHungUp ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>
                          {contact.disposition}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><PhoneCall size={13} /> {phone}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={13} /> {new Date(contact.lastModified).toLocaleDateString()}</span>
                        {contact.agentName && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>by {contact.agentName}</span>}
                      </div>
                      
                      {contact.remarks && (
                        <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          "{contact.remarks.substring(0, 80)}{contact.remarks.length > 80 ? '…' : ''}"
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="action-box">
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {contact.rechurnCount} Attempts Made
                    </div>
                    {/* Action buttons removed as per user request */}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .contact-list-item {
          transition: transform var(--t-base), box-shadow var(--t-base);
          background: linear-gradient(135deg, rgba(220,38,38,0.02) 0%, transparent 100%);
        }
        .contact-list-item:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(0,0,0,0.1); }
        .contact-list-inner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
        }
        .action-box { text-align: right; min-width: 140px; flex-shrink: 0; }
        @media (max-width: 640px) {
          .contact-list-inner { flex-direction: column; align-items: stretch; }
          .action-box { text-align: left; border-top: 1px solid var(--border); padding-top: 14px; display: flex; justify-content: space-between; align-items: center; }
        }
      `}</style>
    </div>
  );
};

export default HungUp;
