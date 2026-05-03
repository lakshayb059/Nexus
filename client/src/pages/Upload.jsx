import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import { UploadCloud, FileSpreadsheet, Trash2, Download, Share2, X, CheckCircle2 } from 'lucide-react';

const Upload = () => {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const [agents,         setAgents]         = useState([]);
  const [batches,        setBatches]        = useState([]);
  const [selectedAgent,  setSelectedAgent]  = useState('');
  const [batchName,      setBatchName]      = useState('');
  const [file,           setFile]           = useState(null);
  const [isUploading,    setIsUploading]    = useState(false);
  const [isDragging,     setIsDragging]     = useState(false);
  const [handoverBatch,  setHandoverBatch]  = useState(null);
  const [targetAgentId,  setTargetAgentId]  = useState('');
  const fileInputRef = useRef(null);

  const fetchData = React.useCallback(async () => {
    if (!user) return;
    try {
      if (user.role === 'agent') {
        setAgents([user]);
        setSelectedAgent(prev => prev || user._id);
        setBatches([]);
      } else {
        const endpoint = user.role === 'admin' ? '/users' : '/users/my-agents';
        const [usersRes, batchesRes] = await Promise.all([api.get(endpoint), api.get('/upload/batches')]);
        setAgents(usersRes.data.filter(u => u.role === 'agent' && u.active));
        setBatches(batchesRes.data);
      }
    } catch (err) {
      console.error('Fetch data failed', err);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
    if (!socket) return;
    const events = ['batch_uploaded', 'users_updated', 'contacts_updated'];
    events.forEach(e => socket.on(e, fetchData));
    return () => events.forEach(e => socket.off(e, fetchData));
  }, [socket, fetchData]);

  const validateFile = (f) => {
    if (!f) return false;
    const valid = f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls');
    if (!valid) { alert('Please select a CSV or Excel file'); return false; }
    if (f.size > 10 * 1024 * 1024) { alert('File must be less than 10MB'); return false; }
    return true;
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (validateFile(f)) setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (validateFile(f)) setFile(f);
  };

  const handleUpload = async () => {
    if (!selectedAgent || !file) { alert('Please select an agent and a file'); return; }
    setIsUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('agentId', selectedAgent);
    if (batchName) fd.append('batchName', batchName);
    try {
      await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFile(null);
      setBatchName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      alert('File uploaded successfully!');
    } catch (err) {
      alert(err.response?.data?.error || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteBatch = async (batchId) => {
    if (!window.confirm('Delete this batch and ALL its contacts? This cannot be undone.')) return;
    try {
      await api.delete(`/contacts/batch/${batchId}`);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleHandover = async () => {
    try {
      await api.put(`/contacts/batch/${handoverBatch._id}/handover`, { agentId: targetAgentId });
      setHandoverBatch(null);
      setTargetAgentId('');
      fetchData();
      alert('Batch handed over successfully!');
    } catch (err) {
      alert(err.response?.data?.error || 'Handover failed');
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await api.get('/upload/template?format=csv', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.setAttribute('download', 'crm-template.csv');
      document.body.appendChild(a); a.click(); a.remove();
    } catch {
      alert('Failed to download template');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--h1)' }}>
            <UploadCloud size={24} style={{ color: 'var(--primary)' }} /> Data Import
          </h1>
          <p className="page-subtitle">Upload CSV/Excel contacts and assign them to agents in real-time</p>
        </div>
      </div>

      <div className="upload-grid">
        {/* Upload form */}
        <div className="glass-panel" style={{ padding: 'var(--card-p)' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSpreadsheet size={15} style={{ color: 'var(--primary)' }} /> New Upload
          </h2>

          <div className="input-group">
            <label>Assign to Agent *</label>
            <select className="input-field" value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}>
              <option value="">-- Select Agent --</option>
              {agents.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </div>

          <div className="input-group">
            <label>Batch Name (Optional)</label>
            <input type="text" className="input-field" placeholder="e.g. Q3 Premium Leads" value={batchName} onChange={e => setBatchName(e.target.value)} />
          </div>

          {/* Drag-drop zone */}
          <div
            className="dropzone"
            style={{ borderColor: isDragging ? 'var(--primary)' : file ? 'var(--success)' : 'var(--border)' }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {file ? (
              <>
                <CheckCircle2 size={36} style={{ color: 'var(--success)', marginBottom: 10 }} />
                <div style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>{file.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{(file.size / 1024).toFixed(1)} KB</div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: 10, fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={e => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                >
                  Remove
                </button>
              </>
            ) : (
              <>
                <UploadCloud size={36} style={{ color: isDragging ? 'var(--primary)' : 'var(--text-muted)', marginBottom: 10 }} />
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{isDragging ? 'Drop to upload' : 'Drag & drop or click to browse'}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>CSV or Excel files · Max 10MB</div>
              </>
            )}
          </div>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".csv,.xlsx,.xls" onChange={handleFileChange} />

          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 18, height: 46 }}
            onClick={handleUpload}
            disabled={isUploading || !file || !selectedAgent}
          >
            {isUploading
              ? <><span className="animate-spin" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block' }} /> Uploading…</>
              : <><UploadCloud size={16} /> Upload Data</>
            }
          </button>

          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={downloadTemplate}>
              <Download size={13} /> Download CSV Template
            </button>
          </div>
        </div>

        {/* Batch history */}
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', margin: 0 }}>Upload History</h2>
            <span className="badge badge-primary">{batches.length} Batches</span>
          </div>
          <div className="table-responsive">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Agent</th>
                  <th>Records</th>
                  <th>Date</th>
                  {['admin', 'tl'].includes(user?.role) && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No uploads yet</td></tr>
                ) : batches.map(b => (
                  <tr key={b._id}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{b.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{b.fileName}</div>
                    </td>
                    <td><span className="badge badge-success">{b.agentName}</span></td>
                    <td style={{ fontWeight: 700 }}>{b.totalContacts}</td>
                    <td>
                      <div style={{ fontSize: '0.875rem' }}>{new Date(b.uploadedAt).toLocaleDateString()}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(b.uploadedAt).toLocaleTimeString()}</div>
                    </td>
                    {['admin', 'tl'].includes(user?.role) && (
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          {user.role === 'tl' && (
                            <button className="btn btn-primary btn-icon" title="Handover" onClick={() => { setHandoverBatch(b); setTargetAgentId(''); }}>
                              <Share2 size={15} />
                            </button>
                          )}
                          {user.role === 'admin' && (
                            <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => handleDeleteBatch(b._id)}>
                              <Trash2 size={15} style={{ color: 'var(--danger)' }} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Handover Modal */}
      {handoverBatch && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setHandoverBatch(null)}>
          <div className="modal-box animate-fade-in">
            <div className="modal-header">
              <h2>Handover Batch</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setHandoverBatch(null)}><X size={18} /></button>
            </div>
            <div style={{ background: 'var(--bg-surface-2)', borderRadius: 'var(--r-md)', padding: '12px 16px', marginBottom: 20, fontSize: '0.875rem' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Batch: </span><strong>{handoverBatch.name}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Records: </span><strong>{handoverBatch.totalContacts}</strong></div>
            </div>
            <div className="input-group">
              <label>Select Target Agent</label>
              <select className="input-field" value={targetAgentId} onChange={e => setTargetAgentId(e.target.value)}>
                <option value="">-- Choose Agent --</option>
                {agents.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-outline" onClick={() => setHandoverBatch(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleHandover} disabled={!targetAgentId}>Confirm Handover</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .upload-grid {
          display: grid;
          grid-template-columns: 340px 1fr;
          gap: var(--gap);
          align-items: start;
        }
        @media (max-width: 1024px) {
          .upload-grid { grid-template-columns: 1fr; }
        }
        .dropzone {
          border: 2px dashed;
          border-radius: var(--r-lg);
          padding: 36px 24px;
          text-align: center;
          cursor: pointer;
          transition: all var(--t-base);
          background: var(--bg-surface-2);
          margin-top: 4px;
        }
        .dropzone:hover { border-color: var(--primary); background: var(--bg-surface-hover); }
      `}</style>
    </div>
  );
};

export default Upload;
