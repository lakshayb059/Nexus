import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { useSocket } from '../contexts/SocketContext';
import { Users as UsersIcon, Plus, Edit2, Shield, UserCheck, Search, X } from 'lucide-react';

const Users = () => {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen,  setIsModalOpen]  = useState(false);
  const [editingUser,  setEditingUser]  = useState(null);
  const [formData,     setFormData]     = useState({ name: '', username: '', password: '', role: 'agent', active: true, tlId: '' });
  
  // New state for TL disposition
  const [showActionModal, setShowActionModal]           = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [dispositionData, setDispositionData]           = useState({ action: 'reassign', newTlId: '' });
  const [affectedAgentsCount, setAffectedAgentsCount]   = useState(0);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err) {
      console.error('Fetch users failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    if (!socket) return;
    socket.on('users_updated', fetchUsers);
    return () => socket.off('users_updated', fetchUsers);
  }, [socket]);

  const tls     = users.filter(u => u.role === 'tl');
  const admins  = users.filter(u => u.role === 'admin');
  const agents  = users.filter(u => u.role === 'agent');

  const filtered = users
    .filter(u => u.role !== 'admin')
    .filter(u =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.username.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => (a.role === 'tl' && b.role === 'agent') ? -1 : (a.role === 'agent' && b.role === 'tl') ? 1 : 0);

  const openModal = (u = null) => {
    if (u) {
      setEditingUser(u);
      setFormData({ name: u.name, username: u.username, password: '', role: u.role, active: u.active, tlId: u.tlId || '' });
    } else {
      setEditingUser(null);
      setFormData({ name: '', username: '', password: '', role: 'agent', active: true, tlId: '' });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e, forceDisposition = false, reactivateAction = null) => {
    if (e) e.preventDefault();
    try {
      if (editingUser) {
        // Special check for TL inactivation
        if (editingUser.role === 'tl' && formData.active === false && editingUser.active === true && !forceDisposition) {
          const agentsToHandle = agents.filter(a => a.tlId === editingUser._id);
          if (agentsToHandle.length > 0) {
            setAffectedAgentsCount(agentsToHandle.length);
            setShowActionModal(true);
            return;
          }
        }

        // Special check for TL reactivation
        if (editingUser.role === 'tl' && formData.active === true && editingUser.active === false && reactivateAction === null) {
          const inactiveAgentsToHandle = agents.filter(a => a.tlId === editingUser._id && !a.active);
          if (inactiveAgentsToHandle.length > 0) {
            setAffectedAgentsCount(inactiveAgentsToHandle.length);
            setShowReactivateModal(true);
            return;
          }
        }

        const payload = { name: formData.name, active: formData.active };
        if (formData.password) payload.password = formData.password;
        if (formData.role === 'agent') payload.tlId = formData.tlId;
        
        if (forceDisposition) {
          payload.agentAction = dispositionData.action;
          if (dispositionData.action === 'reassign') {
            payload.newTlId = dispositionData.newTlId;
          }
        }

        if (reactivateAction !== null) {
          payload.reactivateAgents = reactivateAction;
        }

        await api.put(`/users/${editingUser._id}`, payload);
      } else {
        await api.post('/users', formData);
      }
      setIsModalOpen(false);
      setShowActionModal(false);
      setShowReactivateModal(false);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Operation failed');
    }
  };

  const otherTls = tls.filter(t => t._id !== editingUser?._id && t.active);

  const roleStyles = {
    admin: { label: 'Admin',     cls: 'badge-primary' },
    tl:    { label: 'Team Lead', cls: 'badge-warning' },
    agent: { label: 'Agent',     cls: 'badge-success' },
  };

  if (user?.role !== 'admin') {
    return (
      <div className="glass-panel" style={{ padding: 60, textAlign: 'center' }}>
        <Shield size={48} style={{ opacity: 0.15, margin: '0 auto 16px', display: 'block' }} />
        <h3>Access Denied</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 'var(--h1)', fontWeight: 900, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <UsersIcon size={20} color="var(--primary)" /> User Management
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4 }}>Manage team leads and agents</p>
        </div>
        <button id="add-user-btn" className="btn btn-primary" onClick={() => openModal()} style={{ padding: '10px 20px' }}>
          <Plus size={16} /> Add User
        </button>
      </div>

      <div className="grid-stats" style={{ marginBottom: 20 }}>
        <div className="glass-panel" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Shield size={16} /></div>
          <div><div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)' }}>{admins.length}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase' }}>Admins</div></div>
        </div>
        <div className="glass-panel" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 36, height: 36, background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UserCheck size={16} /></div>
          <div><div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)' }}>{tls.length}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase' }}>Team Leads</div></div>
        </div>
        <div className="glass-panel" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 36, height: 36, background: 'var(--success-light)', color: 'var(--success)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UsersIcon size={16} /></div>
          <div><div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)' }}>{agents.length}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase' }}>Agents</div></div>
        </div>
      </div>

      <div className="glass-panel" style={{ marginBottom: 20, padding: 12 }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" className="input-field" placeholder="Search by name or username…" style={{ paddingLeft: 36, marginBottom: 0 }}
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div className="table-responsive">
          <table className="crm-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Reports To</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: '80%', borderRadius: 6 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No users found</td></tr>
              ) : filtered.map(u => {
                const tl = tls.find(t => t._id === u.tlId);
                const rs = roleStyles[u.role] || roleStyles.agent;
                return (
                  <tr key={u._id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="avatar avatar-sm" style={{
                          background: u.role === 'admin' ? 'rgba(245,158,11,0.15)' : u.role === 'tl' ? 'var(--primary-light)' : 'var(--success-light)',
                          color: u.role === 'admin' ? '#f59e0b' : u.role === 'tl' ? 'var(--primary)' : 'var(--success)',
                        }}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '0.82rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={`badge ${rs.cls}`}>{rs.label}</span></td>
                    <td><span className={`badge ${u.active ? 'badge-success' : 'badge-danger'}`}>{u.active ? 'Active' : 'Inactive'}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{u.role === 'agent' ? (tl?.name || 'Unassigned') : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-outline btn-icon" onClick={() => openModal(u)} title="Edit"><Edit2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setIsModalOpen(false)}>
          <div className="modal-box animate-fade-in" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>{editingUser ? 'Edit User' : 'Create New User'}</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>Full Name *</label>
                  <input type="text" className="input-field" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} required />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label>Username *</label>
                  <input type="text" className="input-field" value={formData.username} onChange={e => setFormData(p => ({ ...p, username: e.target.value }))} disabled={!!editingUser} required />
                </div>
              </div>
              <div className="input-group" style={{ marginTop: 12 }}>
                <label>{editingUser ? 'New Password (blank = keep)' : 'Password *'}</label>
                <input type="password" className="input-field" value={formData.password} onChange={e => setFormData(p => ({ ...p, password: e.target.value }))} required={!editingUser} />
              </div>
              {!editingUser && (
                <div className="input-group">
                  <label>Role</label>
                  <select className="input-field" value={formData.role} onChange={e => setFormData(p => ({ ...p, role: e.target.value }))}>
                    <option value="agent">Agent</option>
                    <option value="tl">Team Lead</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              )}
              {editingUser && (
                <div className="input-group">
                  <label>Status</label>
                  <select className="input-field" value={formData.active} onChange={e => setFormData(p => ({ ...p, active: e.target.value === 'true' }))}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              )}
              {formData.role === 'agent' && (
                <div className="input-group">
                  <label>Assign to Team Lead</label>
                  <select className="input-field" value={formData.tlId} onChange={e => setFormData(p => ({ ...p, tlId: e.target.value }))}>
                    <option value="">-- Select Team Lead --</option>
                    {tls.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingUser ? 'Save Changes' : 'Create User'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Disposition Modal (Sub-modal for TL Inactivation) */}
      {showActionModal && (
        <div className="modal-overlay" style={{ zIndex: 3001 }}>
          <div className="modal-box animate-fade-in" style={{ maxWidth: 450, border: '1px solid var(--danger-light)' }}>
            <div className="modal-header">
              <h2 style={{ color: 'var(--danger)' }}>Handle Assigned Agents</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowActionModal(false)}><X size={18} /></button>
            </div>
            <div style={{ padding: '0 20px 20px' }}>
              <div className="alert alert-warning" style={{ marginBottom: 20 }}>
                You are inactivating <strong>{editingUser?.name}</strong>. There are <strong>{affectedAgentsCount}</strong> agents assigned to them.
              </div>
              
              <div className="input-group">
                <label>What should happen to these agents?</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
                    <input type="radio" name="disposition" value="reassign" checked={dispositionData.action === 'reassign'} 
                      onChange={e => setDispositionData(p => ({ ...p, action: e.target.value }))} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Reassign to another Team Lead</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Move agents to a replacement lead</div>
                    </div>
                  </label>
                  
                  {dispositionData.action === 'reassign' && (
                    <div style={{ marginLeft: 30, marginTop: -4 }}>
                      {otherTls.length === 0 ? (
                        <div className="alert alert-danger" style={{ fontSize: '0.75rem', padding: '8px 12px' }}>
                          🚨 No other active Team Leaders available. Please create another Team Lead first!
                        </div>
                      ) : (
                        <select className="input-field" value={dispositionData.newTlId} 
                          onChange={e => setDispositionData(p => ({ ...p, newTlId: e.target.value }))}
                          style={{ fontSize: '0.8rem', padding: '8px 12px' }}>
                          <option value="">-- Choose New Team Lead --</option>
                          {otherTls.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                        </select>
                      )}
                    </div>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
                    <input type="radio" name="disposition" value="inactivate" checked={dispositionData.action === 'inactivate'} 
                      onChange={e => setDispositionData(p => ({ ...p, action: e.target.value }))} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Inactivate all assigned agents</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Set all {affectedAgentsCount} agents to inactive status</div>
                    </div>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowActionModal(false)}>Cancel</button>
                <button type="button" className="btn btn-danger" 
                  disabled={dispositionData.action === 'reassign' && !dispositionData.newTlId}
                  onClick={() => handleSubmit(null, true)}>
                  Confirm & Inactivate TL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reactivation Modal (Sub-modal for TL Activation) */}
      {showReactivateModal && (
        <div className="modal-overlay" style={{ zIndex: 3001 }}>
          <div className="modal-box animate-fade-in" style={{ maxWidth: 450, border: '1px solid var(--success-light)' }}>
            <div className="modal-header">
              <h2 style={{ color: 'var(--success)' }}>Reactivate Agents?</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowReactivateModal(false)}><X size={18} /></button>
            </div>
            <div style={{ padding: '0 20px 20px' }}>
              <div className="alert alert-success" style={{ marginBottom: 20 }}>
                You are reactivating <strong>{editingUser?.name}</strong>. There are <strong>{affectedAgentsCount}</strong> inactive agents assigned to them.
              </div>
              
              <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 20 }}>
                Would you also like to set these <strong>{affectedAgentsCount}</strong> agents to <strong>Active</strong> status?
              </p>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                <button type="button" className="btn btn-outline" onClick={() => handleSubmit(null, false, false)}>
                  No, Keep Agents Inactive
                </button>
                <button type="button" className="btn btn-success" onClick={() => handleSubmit(null, false, true)}>
                  Yes, Activate All Agents
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
