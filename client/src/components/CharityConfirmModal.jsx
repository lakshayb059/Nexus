import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, ShieldCheck, RotateCw } from 'lucide-react';
import api from '../utils/api';

const CharityConfirmModal = ({ lead, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    utrCharity: lead?.utrCharity || '',
    charityAmount: (lead?.charityAmount !== null && lead?.charityAmount !== undefined) 
      ? lead.charityAmount 
      : (lead?.leadAmount || '')
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!lead) return null;

  const leadName = lead.fields?.Name || lead.fields?.name || lead.fields?.['Full Name'] || lead.name || 'Lead';
  const internalUtr = lead.transactionId || 'N/A';
  const agentAmount = lead.leadAmount || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!formData.utrCharity || !formData.utrCharity.trim()) {
      setErrorMsg('Please enter the UTR / Transaction ID provided by the charity.');
      return;
    }

    if (formData.charityAmount === '' || isNaN(parseFloat(formData.charityAmount))) {
      setErrorMsg('Please enter a valid charity donation amount.');
      return;
    }

    const numAmount = parseFloat(formData.charityAmount);
    if (numAmount < 0) {
      setErrorMsg('Charity amount cannot be negative.');
      return;
    }

    setSubmitting(true);
    try {
      const leadId = lead._id || lead.id || lead.contactId;
      const payload = {
        utrCharity: formData.utrCharity.trim(),
        charityAmount: numAmount
      };

      const res = await api.put(`/leads/${leadId}/confirm-charity`, payload);
      if (res.data?.success) {
        if (onSuccess) {
          onSuccess({
            ...lead,
            ...payload,
            isCharityConfirmed: true,
            charityConfirmedAt: new Date().toISOString()
          });
        }
        onClose();
      }
    } catch (err) {
      console.error('Charity confirm error:', err);
      setErrorMsg(err.response?.data?.error || 'Failed to confirm by charity. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div 
      className="detail-modal-overlay animate-fade-in" 
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000000,
        padding: '20px 16px',
        boxSizing: 'border-box'
      }}
    >
      <div 
        className="detail-modal-content animate-scale-up" 
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)',
          width: '100%',
          maxWidth: '520px',
          borderRadius: '20px',
          boxShadow: '0 30px 90px -10px rgba(0, 0, 0, 0.5)',
          border: '1px solid var(--border)',
          margin: 'auto',
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto'
        }}
      >
        {/* Modal Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <ShieldCheck size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Confirmed by Charity
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {leadName}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 8
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px' }}>
          {/* Reference Info Card */}
          <div style={{
            background: 'var(--bg-surface-2)',
            borderRadius: '12px',
            padding: '14px 16px',
            border: '1px solid var(--border)',
            marginBottom: '18px',
            fontSize: '0.82rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Internal UTR (Preserved):</span>
              <span className="badge badge-primary" style={{ fontWeight: 800, fontSize: '0.75rem', padding: '3px 8px' }}>
                UTR-Internal: {internalUtr}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Agent Reported Amount:</span>
              <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                ₹{agentAmount.toLocaleString()}
              </span>
            </div>
          </div>

          {errorMsg && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              padding: '10px 14px',
              borderRadius: 10,
              fontSize: '0.82rem',
              fontWeight: 600,
              marginBottom: 16
            }}>
              {errorMsg}
            </div>
          )}

          {/* UTR-Charity Field */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="modalUtrCharity" style={{ fontSize: '0.8rem', fontWeight: 800, marginBottom: 6, display: 'block', color: 'var(--text-primary)' }}>
              UTR-CHARITY (FROM CONFIRMATION EMAIL) *
            </label>
            <input 
              id="modalUtrCharity"
              type="text" 
              className="input-field" 
              value={formData.utrCharity} 
              onChange={e => setFormData(p => ({ ...p, utrCharity: e.target.value }))}
              placeholder="e.g. 523412984920 or charity payment ref ID..."
              autoFocus
              required
              style={{ marginBottom: 0 }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Enter the transaction UTR number received in the reply email from charity.
            </span>
          </div>

          {/* Charity Amount Field */}
          <div style={{ marginBottom: 20 }}>
            <label htmlFor="modalCharityAmount" style={{ fontSize: '0.8rem', fontWeight: 800, marginBottom: 6, display: 'block', color: 'var(--text-primary)' }}>
              CHARITY AMOUNT (₹) *
            </label>
            <input 
              id="modalCharityAmount"
              type="number" 
              step="any"
              className="input-field" 
              value={formData.charityAmount} 
              onChange={e => setFormData(p => ({ ...p, charityAmount: e.target.value }))}
              placeholder="e.g. 3000"
              required
              style={{ marginBottom: 0 }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Confirmed charity donation amount. This amount takes priority in revenue sums and reports.
            </span>
          </div>

          {/* Modal Footer Buttons */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button 
              type="button" 
              onClick={onClose} 
              className="btn btn-outline" 
              disabled={submitting}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ background: '#10b981', borderColor: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }} 
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <RotateCw className="animate-spin" size={16} />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  Confirm & Save Charity UTR
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default CharityConfirmModal;
