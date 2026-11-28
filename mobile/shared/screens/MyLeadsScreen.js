import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../services/api';
import { COLORS, LEAD_STATUS_OPTIONS } from '../theme';
import {
  GlassCard,
  StatCard,
  Badge,
  EmptyState,
  getContactName,
  getContactPhone,
  formatCurrency,
  formatDateTime,
  openDialer,
  openWhatsApp,
} from '../components/UI';
import DateTimeField from '../components/DateTimeField';
import {
  ReceiptUploadModal,
  LeadStatusModal,
  CharityConfirmModal,
  CreateLeadModal,
  CallActionModal,
  LeadDetailModal,
  ConversionHistoryModal,
  DuplicateLeadModal,
} from '../components/ReceiptModals';
import {
  Star,
  TrendingUp,
  Search,
  Plus,
  PhoneCall,
  MessageCircle,
  Trash2,
  ShieldCheck,
  Image as ImageIcon,
  Award,
  Target,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  CheckSquare,
  Square,
  Edit3,
} from 'lucide-react-native';

const STATUS_COLORS = {
  Converted: { color: '#059669', bg: 'rgba(5,150,105,0.12)' },
  'Call Back': { color: '#0891b2', bg: 'rgba(8,145,178,0.12)' },
  'Not Interested': { color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  'DNC/DND': { color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  Others: { color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
};

const DATE_PRESETS = [
  { key: 'all', label: 'All Dates' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_30_days', label: 'Last 30 Days' },
  { key: 'custom', label: 'Custom Date...' },
];

const AMOUNT_PRESETS = [
  { key: 'all', label: 'All Amounts' },
  { key: '0-1k', label: '₹0 - ₹1,000' },
  { key: '1k-5k', label: '₹1,000 - ₹5,000' },
  { key: '5k-10k', label: '₹5,000 - ₹10,000' },
  { key: '10k-25k', label: '₹10,000 - ₹25,000' },
  { key: '25k-50k', label: '₹25,000 - ₹50,000' },
  { key: '50k+', label: '₹50,000+' },
  { key: 'custom', label: 'Custom Range...' },
];

const SOURCE_OPTIONS = [
  { key: 'all', label: 'All Sources' },
  { key: 'created', label: 'Agent Added' },
  { key: 'uploaded', label: 'Uploaded' },
];

function fmtDateYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MyLeadsScreen = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [leads, setLeads] = useState([]);
  const leadsRef = useRef(leads);
  leadsRef.current = leads;

  const [stats, setStats] = useState({ totalLeads: 0, totalAmount: 0, allLeadsCount: 0, allLeadsAmount: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [datePreset, setDatePreset] = useState('all');
  const [convertedStartDate, setConvertedStartDate] = useState('');
  const [convertedEndDate, setConvertedEndDate] = useState('');
  const [amountPreset, setAmountPreset] = useState('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);

  // Selection (Admin/SuperAdmin)
  const [selectedIds, setSelectedIds] = useState([]);

  // Active picker sheet ('status' | 'source' | 'date' | 'amount' | 'limit' | 'rowStatus' | null)
  const [pickerType, setPickerType] = useState(null);
  const [rowStatusLead, setRowStatusLead] = useState(null);

  // Modals
  const [detailModal, setDetailModal] = useState({ lead: null, rowNumber: null });
  const [statusModal, setStatusModal] = useState({ lead: null, status: null });
  const [receiptLead, setReceiptLead] = useState(null);
  const [charityLead, setCharityLead] = useState(null);
  const [callActionLead, setCallActionLead] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [historyModal, setHistoryModal] = useState({ contact: null, data: [], loading: false });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  const handleDatePresetChange = (preset) => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'all') {
      setConvertedStartDate('');
      setConvertedEndDate('');
    } else if (preset === 'today') {
      const s = fmtDateYmd(now);
      setConvertedStartDate(s);
      setConvertedEndDate(s);
    } else if (preset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const s = fmtDateYmd(y);
      setConvertedStartDate(s);
      setConvertedEndDate(s);
    } else if (preset === 'this_week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now);
      monday.setDate(diff);
      setConvertedStartDate(fmtDateYmd(monday));
      setConvertedEndDate(fmtDateYmd(now));
    } else if (preset === 'this_month') {
      setConvertedStartDate(fmtDateYmd(new Date(now.getFullYear(), now.getMonth(), 1)));
      setConvertedEndDate(fmtDateYmd(now));
    } else if (preset === 'last_30_days') {
      const p30 = new Date(now);
      p30.setDate(p30.getDate() - 30);
      setConvertedStartDate(fmtDateYmd(p30));
      setConvertedEndDate(fmtDateYmd(now));
    }
  };

  const handleAmountPresetChange = (preset) => {
    setAmountPreset(preset);
    if (preset === 'all') { setMinAmount(''); setMaxAmount(''); }
    else if (preset === '0-1k') { setMinAmount('0'); setMaxAmount('1000'); }
    else if (preset === '1k-5k') { setMinAmount('1000'); setMaxAmount('5000'); }
    else if (preset === '5k-10k') { setMinAmount('5000'); setMaxAmount('10000'); }
    else if (preset === '10k-25k') { setMinAmount('10000'); setMaxAmount('25000'); }
    else if (preset === '25k-50k') { setMinAmount('25000'); setMaxAmount('50000'); }
    else if (preset === '50k+') { setMinAmount('50000'); setMaxAmount(''); }
  };

  const buildQueryParams = useCallback((targetPage, targetLimit) => {
    const params = new URLSearchParams();
    if (search.trim()) params.append('search', search.trim());
    if (sourceFilter !== 'all') params.append('source', sourceFilter);
    if (statusFilter !== 'all') params.append('status', statusFilter);
    if (convertedStartDate) params.append('convertedFrom', convertedStartDate);
    if (convertedEndDate) params.append('convertedTo', convertedEndDate);
    if (minAmount) params.append('minAmount', minAmount);
    if (maxAmount) params.append('maxAmount', maxAmount);
    params.append('page', String(targetPage));
    params.append('limit', String(targetLimit));
    params.append('sort', 'desc');
    return params;
  }, [search, sourceFilter, statusFilter, convertedStartDate, convertedEndDate, minAmount, maxAmount]);

  const fetchLeads = useCallback(async (silent = false, targetPage = 1, overrideLimit = null) => {
    const activeLimit = overrideLimit || limit;
    if (!silent) setLoading(true);
    try {
      const params = buildQueryParams(targetPage, activeLimit);
      const [leadsRes, statsRes] = await Promise.all([
        api.get(`/leads/my-leads?${params.toString()}`),
        api.get(`/leads/stats?${params.toString()}`),
      ]);
      const incoming = Array.isArray(leadsRes.data?.leads)
        ? leadsRes.data.leads
        : (Array.isArray(leadsRes.data) ? leadsRes.data : []);
      setLeads(incoming);
      const tp = leadsRes.data?.pages || 1;
      setTotalPages(tp);
      setTotalCount(leadsRes.data?.total ?? incoming.length);
      setPage(targetPage);
      pageRef.current = targetPage;
      setHasMore(targetPage < tp);
      if (statsRes.data) setStats(statsRes.data);
    } catch {
      // Keep existing state on error
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams, limit]);

  useEffect(() => {
    const t = setTimeout(() => fetchLeads(false, 1), 250);
    return () => clearTimeout(t);
  }, [fetchLeads]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const nextPage = pageRef.current + 1;
      const params = buildQueryParams(nextPage, limit);
      const res = await api.get(`/leads/my-leads?${params.toString()}`);
      const nextLeads = Array.isArray(res.data?.leads)
        ? res.data.leads
        : (Array.isArray(res.data) ? res.data : []);
      if (nextLeads.length > 0) {
        setLeads((prev) => {
          const seen = new Set(prev.map((l) => l._id || l.id));
          return [...prev, ...nextLeads.filter((l) => !seen.has(l._id || l.id))];
        });
        setPage(nextPage);
        pageRef.current = nextPage;
      }
      const tp = res.data?.pages || 1;
      setTotalPages(tp);
      setHasMore(nextPage < tp && nextLeads.length >= limit);
    } catch {
      // Ignore
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!socket) return;
    const uid = user?._id || user?.id;

    const onLeadUpdated = (payload) => {
      if (!payload) return;
      const targetId = payload.leadId || payload.contactId;
      const updates = payload.data || payload.lead || {};
      setLeads((prev) =>
        prev.map((item) => {
          const itemId = item._id || item.id || item.contactId;
          if (itemId === targetId || itemId === payload.originalContactId) {
            return { ...item, ...updates, lastModified: new Date() };
          }
          return item;
        })
      );
      api.get('/leads/stats').then((r) => { if (r.data) setStats(r.data); }).catch(() => {});
    };

    const onRefresh = () => fetchLeads(true, 1);
    const onEmailStatus = (data) => {
      if (data && data.agentId === uid) {
        showToast(
          data.success ? 'Receipt email sent successfully!' : `Email sending failed: ${data.reason}`,
          data.success ? 'success' : 'error'
        );
      }
    };

    socket.on('lead_updated', onLeadUpdated);
    socket.on('contact_disposed', onLeadUpdated);
    socket.on('lead_created', onRefresh);
    socket.on('contacts_updated', onRefresh);
    socket.on('email_status', onEmailStatus);
    return () => {
      socket.off('lead_updated', onLeadUpdated);
      socket.off('contact_disposed', onLeadUpdated);
      socket.off('lead_created', onRefresh);
      socket.off('contacts_updated', onRefresh);
      socket.off('email_status', onEmailStatus);
    };
  }, [socket, user, fetchLeads]);

  const openHistory = async (phone, name) => {
    setHistoryModal({ contact: { phone, name }, data: [], loading: true });
    try {
      const res = await api.get(`/leads/history/${encodeURIComponent(phone)}`);
      setHistoryModal({ contact: { phone, name }, data: Array.isArray(res.data) ? res.data : [], loading: false });
    } catch {
      setHistoryModal({ contact: { phone, name }, data: [], loading: false });
    }
  };

  const handleCreateLead = async (payload) => {
    setSubmitting(true);
    try {
      const res = await api.post('/leads/create', payload);
      setCreateOpen(false);
      await fetchLeads(false, 1);
      showToast('Lead created successfully!', 'success');
      if ((res.data?.duplicateFound || res.data?.hasDuplicates) && res.data?.duplicates?.length > 0) {
        setDuplicateInfo({ lead: res.data.lead, duplicates: res.data.duplicates });
      }
    } catch (err) {
      Alert.alert('Create Lead Error', err.response?.data?.error || 'Could not create lead.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveStatus = async (formData) => {
    if (!statusModal.lead || !statusModal.status) return;
    const lead = statusModal.lead;
    const nextStatus = statusModal.status;
    const cid = lead.contactId || lead._id || lead.id;
    const leadId = lead._id || lead.id;

    setSubmitting(true);
    try {
      if (nextStatus === 'Call Back') {
        const checkRes = await api.get(`/contacts/${cid}/check-callback`);
        if (checkRes.data?.exists && checkRes.data?.callback) {
          const existing = checkRes.data.callback;
          setSubmitting(false);
          Alert.alert(
            'Existing Callback Found',
            `A callback already exists for ${formatDateTime(existing.callBackDt)}.\n\nUpdate existing callback or create a new one?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Create New',
                onPress: async () => {
                  setSubmitting(true);
                  try {
                    await api.put(`/leads/${leadId}`, { status: nextStatus, ...formData });
                    setStatusModal({ lead: null, status: null });
                    await fetchLeads(true, pageRef.current);
                    showToast(`Lead status updated to ${nextStatus}!`, 'success');
                  } catch (e) {
                    Alert.alert('Update Error', e.response?.data?.error || 'Failed to update.');
                  } finally {
                    setSubmitting(false);
                  }
                },
              },
              {
                text: 'Update Existing',
                onPress: async () => {
                  setSubmitting(true);
                  try {
                    await api.put(`/leads/callbacks/${existing._id || existing.id}`, {
                      callBackDt: formData.callBackDt,
                      remarks: formData.remarks || '[Status update to Call Back]',
                    });
                    setStatusModal({ lead: null, status: null });
                    await fetchLeads(true, pageRef.current);
                    showToast('Existing callback updated!', 'success');
                  } catch (e) {
                    Alert.alert('Update Error', e.response?.data?.error || 'Failed to update callback.');
                  } finally {
                    setSubmitting(false);
                  }
                },
              },
            ]
          );
          return;
        }
      }

      await api.put(`/leads/${leadId}`, { status: nextStatus, ...formData });
      setStatusModal({ lead: null, status: null });
      await fetchLeads(true, pageRef.current);
      showToast(
        nextStatus === 'Converted'
          ? 'Lead Converted! Email will be sent in background.'
          : `Lead status updated to ${nextStatus}!`,
        'success'
      );
    } catch (err) {
      Alert.alert('Update Error', err.response?.data?.error || 'Failed to update lead status.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCallActionSubmit = async (data) => {
    if (!callActionLead) return;
    const cid = callActionLead.contactId || callActionLead._id || callActionLead.id;
    try {
      const res = await api.post(`/leads/${cid}/clone-and-dispose`, data);
      if (res.data?.success) {
        setCallActionLead(null);
        await fetchLeads(true, pageRef.current);
        showToast(`Call action saved. Status: ${data.status || 'Updated'}`, 'success');
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to save call action.');
    }
  };

  const handleDeleteLead = (leadId) => {
    Alert.alert('Delete Lead', 'Delete this lead permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/leads/${leadId}`);
            setSelectedIds((prev) => prev.filter((x) => x !== leadId));
            await fetchLeads(true, pageRef.current);
            showToast('Lead deleted.', 'success');
          } catch {
            Alert.alert('Error', 'Delete failed.');
          }
        },
      },
    ]);
  };

  const handleBulkDelete = () => {
    Alert.alert('Delete Selected', `Delete ${selectedIds.length} selected leads?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post('/leads/bulk-delete', { ids: selectedIds });
            setSelectedIds([]);
            await fetchLeads(true, pageRef.current);
            showToast('Selected leads deleted.', 'success');
          } catch {
            Alert.alert('Error', 'Bulk delete failed.');
          }
        },
      },
    ]);
  };

  const handleWipeAllLeads = () => {
    Alert.alert('Wipe All Leads', 'WARNING: Delete ALL leads permanently? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Wipe All',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete('/leads/wipe');
            await fetchLeads(false, 1);
            showToast('All leads wiped.', 'success');
          } catch (err) {
            Alert.alert('Error', err.response?.data?.error || 'Failed to wipe leads.');
          }
        },
      },
    ]);
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === leads.length) setSelectedIds([]);
    else setSelectedIds(leads.map((l) => l._id || l.id));
  };

  const currentDateLabel = DATE_PRESETS.find((d) => d.key === datePreset)?.label || 'All Dates';
  const currentAmountLabel = AMOUNT_PRESETS.find((a) => a.key === amountPreset)?.label || 'All Amounts';
  const currentSourceLabel = SOURCE_OPTIONS.find((s) => s.key === sourceFilter)?.label || 'All Sources';

  return (
    <View style={styles.container}>
      {!!toast && (
        <View
          style={[
            styles.toastBanner,
            { backgroundColor: toast.type === 'error' ? COLORS.danger : COLORS.success },
          ]}
        >
          <Text style={styles.toastTxt}>{toast.message}</Text>
        </View>
      )}

      <FlatList
        data={leads}
        keyExtractor={(item, idx) => item._id || item.id || String(idx)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => fetchLeads(false, 1)} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={{ gap: 11, marginBottom: 10 }}>
            {/* 4 KPI Stat Cards (2x2 Grid matching Web) */}
            <View style={styles.statsGrid}>
              <StatCard title="Total Leads" value={stats.allLeads ?? stats.allLeadsCount ?? 0} subtext="All acquired" icon={Star} accent="#6366f1" />
              <StatCard title="Total Revenue" value={formatCurrency(stats.allLeadsAmount)} subtext="Pipeline value" icon={TrendingUp} accent="#06b6d4" />
              <StatCard title="Converted Leads" value={stats.totalLeads || 0} subtext="Closed deals" icon={Award} accent="#10b981" />
              <StatCard title="Converted Rev." value={formatCurrency(stats.totalAmount)} subtext="Confirmed value" icon={Target} accent="#8b5cf6" />
            </View>

            {/* Search + Create Lead + Admin Bulk Bar */}
            <View style={styles.searchRow}>
              <View style={styles.searchWrap}>
                <Search size={16} color={COLORS.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name, phone, agent, UTR..."
                  placeholderTextColor="#94a3b8"
                  style={styles.searchInput}
                />
                {!!search && (
                  <TouchableOpacity onPress={() => setSearch('')} style={{ padding: 4 }}>
                    <X size={15} color={COLORS.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity onPress={() => setCreateOpen(true)} style={styles.addBtn}>
                <Plus size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Admin Selection & Wipe Bar */}
            {isAdmin && (
              <View style={styles.adminBar}>
                <TouchableOpacity onPress={toggleSelectAll} style={styles.adminChip}>
                  {selectedIds.length > 0 && selectedIds.length === leads.length ? (
                    <CheckSquare size={15} color={COLORS.primary} />
                  ) : (
                    <Square size={15} color={COLORS.textSecondary} />
                  )}
                  <Text style={styles.adminChipTxt}>
                    {selectedIds.length === leads.length && leads.length > 0 ? 'Deselect All' : 'Select All'}
                  </Text>
                </TouchableOpacity>
                {selectedIds.length > 0 ? (
                  <TouchableOpacity onPress={handleBulkDelete} style={[styles.adminChip, { backgroundColor: COLORS.danger, borderColor: COLORS.danger }]}>
                    <Trash2 size={14} color="#fff" />
                    <Text style={[styles.adminChipTxt, { color: '#fff' }]}>Delete ({selectedIds.length})</Text>
                  </TouchableOpacity>
                ) : user?.role === 'superadmin' && (
                  <TouchableOpacity onPress={handleWipeAllLeads} style={[styles.adminChip, { borderColor: '#fecaca', backgroundColor: '#fef2f2' }]}>
                    <Trash2 size={14} color={COLORS.danger} />
                    <Text style={[styles.adminChipTxt, { color: COLORS.danger }]}>Wipe All</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Horizontally Aligned Scrollable Filters */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalFilters}
            >
              <TouchableOpacity
                onPress={() => setPickerType('status')}
                style={[styles.filterPill, statusFilter !== 'all' && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillTxt, statusFilter !== 'all' && styles.filterPillTxtActive]}>
                  {statusFilter === 'all' ? 'All Status' : statusFilter}
                </Text>
                <ChevronDown size={13} color={statusFilter !== 'all' ? '#fff' : COLORS.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setPickerType('source')}
                style={[styles.filterPill, sourceFilter !== 'all' && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillTxt, sourceFilter !== 'all' && styles.filterPillTxtActive]}>
                  {currentSourceLabel}
                </Text>
                <ChevronDown size={13} color={sourceFilter !== 'all' ? '#fff' : COLORS.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setPickerType('date')}
                style={[styles.filterPill, datePreset !== 'all' && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillTxt, datePreset !== 'all' && styles.filterPillTxtActive]}>
                  📅 {currentDateLabel}
                </Text>
                <ChevronDown size={13} color={datePreset !== 'all' ? '#fff' : COLORS.textSecondary} />
              </TouchableOpacity>

              {(convertedStartDate || convertedEndDate) && (
                <TouchableOpacity onPress={() => handleDatePresetChange('all')} style={styles.clearChip}>
                  <X size={12} color={COLORS.danger} />
                  <Text style={styles.clearChipTxt}>Clear Date</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => setPickerType('amount')}
                style={[styles.filterPill, amountPreset !== 'all' && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillTxt, amountPreset !== 'all' && styles.filterPillTxtActive]}>
                  💰 {currentAmountLabel}
                </Text>
                <ChevronDown size={13} color={amountPreset !== 'all' ? '#fff' : COLORS.textSecondary} />
              </TouchableOpacity>

              {(minAmount || maxAmount) && (
                <TouchableOpacity onPress={() => handleAmountPresetChange('all')} style={styles.clearChip}>
                  <X size={12} color={COLORS.danger} />
                  <Text style={styles.clearChipTxt}>Clear Amt</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={() => setPickerType('limit')} style={styles.filterPill}>
                <Text style={styles.filterPillTxt}>{limit} / p</Text>
                <ChevronDown size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </ScrollView>

            {/* Custom Date Range Picker Row */}
            {datePreset === 'custom' && (
              <GlassCard style={{ padding: 10, gap: 6 }}>
                <Text style={styles.customLabel}>CUSTOM DATE RANGE</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <DateTimeField
                      mode="date"
                      value={convertedStartDate}
                      onChange={setConvertedStartDate}
                      placeholder="From Date"
                      style={{ marginBottom: 0 }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <DateTimeField
                      mode="date"
                      value={convertedEndDate}
                      onChange={setConvertedEndDate}
                      placeholder="To Date"
                      style={{ marginBottom: 0 }}
                    />
                  </View>
                </View>
              </GlassCard>
            )}

            {/* Custom Amount Range Inputs */}
            {amountPreset === 'custom' && (
              <GlassCard style={{ padding: 10, gap: 6 }}>
                <Text style={styles.customLabel}>CUSTOM AMOUNT RANGE (₹)</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    keyboardType="numeric"
                    value={minAmount}
                    onChangeText={setMinAmount}
                    placeholder="Min ₹"
                    placeholderTextColor="#94a3b8"
                    style={styles.customAmtInput}
                  />
                  <TextInput
                    keyboardType="numeric"
                    value={maxAmount}
                    onChangeText={setMaxAmount}
                    placeholder="Max ₹"
                    placeholderTextColor="#94a3b8"
                    style={styles.customAmtInput}
                  />
                </View>
              </GlassCard>
            )}

            {/* Pagination & Series Toolbar */}
            <GlassCard style={styles.pagerBar}>
              <Text style={styles.pagerCount}>
                Showing <Text style={{ color: COLORS.primary, fontWeight: '900' }}>{leads.length}</Text> of{' '}
                <Text style={{ fontWeight: '800' }}>{totalCount}</Text>
              </Text>
              <View style={styles.pagerControls}>
                <TouchableOpacity
                  disabled={page <= 1 || loading}
                  onPress={() => fetchLeads(false, page - 1)}
                  style={[styles.pagerBtn, (page <= 1 || loading) && { opacity: 0.4 }]}
                >
                  <ChevronLeft size={16} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.pagerPageTxt}>Page {page}/{Math.max(1, totalPages)}</Text>
                <TouchableOpacity
                  disabled={page >= totalPages || loading}
                  onPress={() => fetchLeads(false, page + 1)}
                  style={[styles.pagerBtn, (page >= totalPages || loading) && { opacity: 0.4 }]}
                >
                  <ChevronRight size={16} color={COLORS.textPrimary} />
                </TouchableOpacity>
              </View>
            </GlassCard>
          </View>
        }
        ListEmptyComponent={
          !loading && (
            <EmptyState
              icon={Star}
              title="No Matching Leads Found"
              subtitle="Adjust your filters or tap + to add a new lead."
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const id = item._id || item.id;
          const fields = item.fields || {};
          const name = getContactName(fields);
          const phone = getContactPhone(fields);
          const rowNumber = index + 1;
          const isSelected = selectedIds.includes(id);
          const isConverted = item.status === 'Converted';
          const isNegative = item.status === 'Not Interested' || item.status === 'DNC/DND';
          const isLocked = isConverted;
          const hasActiveInHistory =
            Array.isArray(item.historyStatuses) &&
            item.historyStatuses.some((s) => s !== 'Converted' && s !== 'Not Interested');
          const isCallLocked = hasActiveInHistory && item.status !== 'Call Back';
          const effAmount =
            item.isCharityConfirmed && item.charityAmount !== null && item.charityAmount !== undefined
              ? item.charityAmount
              : item.leadAmount;
          const effectiveDate =
            item.lastModified ||
            item.disposedAt ||
            item.conversionDate ||
            fields.Date ||
            fields.date ||
            item.createdAt;
          const borderLeft = isConverted
            ? '#10b981'
            : isNegative
            ? '#ef4444'
            : item.status === 'Call Back'
            ? '#06b6d4'
            : COLORS.primary;
          const sc = STATUS_COLORS[item.status] || { color: COLORS.primary, bg: COLORS.primaryLight };

          return (
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={() => setDetailModal({ lead: item, rowNumber })}
            >
              <GlassCard style={[styles.leadCard, { borderLeftWidth: 4, borderLeftColor: borderLeft }]}>
                <View style={styles.cardTop}>
                  <View style={styles.serialRow}>
                    {isAdmin && (
                      <TouchableOpacity
                        onPress={() => toggleSelect(id)}
                        style={[styles.checkBox, isSelected && styles.checkBoxActive]}
                      >
                        {isSelected && <Check size={12} color="#fff" />}
                      </TouchableOpacity>
                    )}
                    <Text style={styles.serialTxt}>#{rowNumber}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.leadName} numberOfLines={1}>{name}</Text>
                    <Text style={styles.leadPhone} numberOfLines={1}>
                      {phone || 'No Phone'} • {item.agentName || 'Agent'}
                    </Text>
                  </View>
                  <Text style={styles.amountText}>{formatCurrency(effAmount)}</Text>
                </View>

                <View style={styles.badgeRow}>
                  <TouchableOpacity
                    disabled={isLocked}
                    onPress={() => {
                      setRowStatusLead(item);
                      setPickerType('rowStatus');
                    }}
                    style={[styles.statusSelectPill, { backgroundColor: sc.bg, borderColor: `${sc.color}40` }]}
                  >
                    <Text style={[styles.statusSelectTxt, { color: sc.color }]}>
                      {item.status || 'Set Status'}
                    </Text>
                    {!isLocked && <ChevronDown size={12} color={sc.color} />}
                  </TouchableOpacity>

                  {item.isCharityConfirmed ? (
                    <Badge
                      label={`✓ UTR: ${item.utrCharity || item.transactionId || 'Confirmed'}`}
                      color={COLORS.success}
                      bg={COLORS.successLight}
                    />
                  ) : (
                    (item.status === 'Converted' || item.transactionId) && (
                      <TouchableOpacity
                        onPress={() => setCharityLead(item)}
                        style={styles.charityTriggerPill}
                      >
                        <ShieldCheck size={12} color={COLORS.success} />
                        <Text style={styles.charityTriggerTxt}>Confirmed by Charity</Text>
                      </TouchableOpacity>
                    )
                  )}

                  {item.leadsCount > 1 && (
                    <TouchableOpacity
                      onPress={() => openHistory(phone, name)}
                      style={styles.convHistoryPill}
                    >
                      <TrendingUp size={11} color={COLORS.violet} />
                      <Text style={styles.convHistoryTxt}>{item.leadsCount} Conv.</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Remarks (Tap to edit when not locked) */}
                <TouchableOpacity
                  disabled={isLocked}
                  onPress={() => setStatusModal({ lead: item, status: item.status || 'Others' })}
                  style={styles.remarksLine}
                >
                  <Text style={styles.remarksTxt} numberOfLines={2}>
                    <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>Remarks: </Text>
                    {item.remarks || item.statusDetails || 'Uploaded via Lead Template'}
                  </Text>
                  {!isLocked && <Edit3 size={13} color={COLORS.primary} />}
                </TouchableOpacity>

                <View style={styles.cardFooter}>
                  <Text style={styles.dateText}>{formatDateTime(effectiveDate)}</Text>
                  <View style={styles.quickIcons}>
                    {!isLocked && user?.role !== 'admin' && !!phone && (
                      <TouchableOpacity onPress={() => setReceiptLead(item)} style={styles.miniBtn}>
                        <ImageIcon size={15} color={COLORS.violet} />
                      </TouchableOpacity>
                    )}
                    {!!phone && (
                      <>
                        <TouchableOpacity onPress={() => openWhatsApp(phone)} style={styles.miniBtn}>
                          <MessageCircle size={15} color="#16a34a" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          disabled={isCallLocked}
                          onPress={() => {
                            setCallActionLead(item);
                            openDialer(phone);
                          }}
                          style={[styles.miniBtn, isCallLocked && { opacity: 0.4 }]}
                        >
                          <PhoneCall size={15} color={isCallLocked ? COLORS.textMuted : COLORS.primary} />
                        </TouchableOpacity>
                      </>
                    )}
                    {isAdmin && (
                      <TouchableOpacity onPress={() => handleDeleteLead(id)} style={styles.miniBtn}>
                        <Trash2 size={15} color={COLORS.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </GlassCard>
            </TouchableOpacity>
          );
        }}
      />

      {/* Filter / Status Picker Sheet Modal */}
      <Modal visible={!!pickerType} transparent animationType="slide" onRequestClose={() => setPickerType(null)}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>
                {pickerType === 'status' ? 'Filter by Status' :
                 pickerType === 'source' ? 'Filter by Source' :
                 pickerType === 'date' ? 'Filter by Date' :
                 pickerType === 'amount' ? 'Filter by Amount' :
                 pickerType === 'limit' ? 'Leads Per Page' : 'Change Lead Status'}
              </Text>
              <TouchableOpacity onPress={() => setPickerType(null)}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {pickerType === 'status' && ['all', ...LEAD_STATUS_OPTIONS].map((st) => (
                <TouchableOpacity
                  key={st}
                  onPress={() => { setStatusFilter(st); setPickerType(null); }}
                  style={[styles.optionRow, statusFilter === st && styles.optionRowActive]}
                >
                  <Text style={[styles.optionTxt, statusFilter === st && styles.optionTxtActive]}>
                    {st === 'all' ? 'All Status' : st}
                  </Text>
                  {statusFilter === st && <Check size={16} color={COLORS.primary} />}
                </TouchableOpacity>
              ))}
              {pickerType === 'source' && SOURCE_OPTIONS.map((s) => (
                <TouchableOpacity
                  key={s.key}
                  onPress={() => { setSourceFilter(s.key); setPickerType(null); }}
                  style={[styles.optionRow, sourceFilter === s.key && styles.optionRowActive]}
                >
                  <Text style={[styles.optionTxt, sourceFilter === s.key && styles.optionTxtActive]}>{s.label}</Text>
                  {sourceFilter === s.key && <Check size={16} color={COLORS.primary} />}
                </TouchableOpacity>
              ))}
              {pickerType === 'date' && DATE_PRESETS.map((d) => (
                <TouchableOpacity
                  key={d.key}
                  onPress={() => { handleDatePresetChange(d.key); setPickerType(null); }}
                  style={[styles.optionRow, datePreset === d.key && styles.optionRowActive]}
                >
                  <Text style={[styles.optionTxt, datePreset === d.key && styles.optionTxtActive]}>{d.label}</Text>
                  {datePreset === d.key && <Check size={16} color={COLORS.primary} />}
                </TouchableOpacity>
              ))}
              {pickerType === 'amount' && AMOUNT_PRESETS.map((a) => (
                <TouchableOpacity
                  key={a.key}
                  onPress={() => { handleAmountPresetChange(a.key); setPickerType(null); }}
                  style={[styles.optionRow, amountPreset === a.key && styles.optionRowActive]}
                >
                  <Text style={[styles.optionTxt, amountPreset === a.key && styles.optionTxtActive]}>{a.label}</Text>
                  {amountPreset === a.key && <Check size={16} color={COLORS.primary} />}
                </TouchableOpacity>
              ))}
              {pickerType === 'limit' && [50, 100, 200].map((lim) => (
                <TouchableOpacity
                  key={lim}
                  onPress={() => { setLimit(lim); setPickerType(null); fetchLeads(false, 1, lim); }}
                  style={[styles.optionRow, limit === lim && styles.optionRowActive]}
                >
                  <Text style={[styles.optionTxt, limit === lim && styles.optionTxtActive]}>{lim} leads per page</Text>
                  {limit === lim && <Check size={16} color={COLORS.primary} />}
                </TouchableOpacity>
              ))}
              {pickerType === 'rowStatus' && LEAD_STATUS_OPTIONS.map((st) => (
                <TouchableOpacity
                  key={st}
                  onPress={() => {
                    const target = rowStatusLead;
                    setPickerType(null);
                    setRowStatusLead(null);
                    if (target) setStatusModal({ lead: target, status: st });
                  }}
                  style={styles.optionRow}
                >
                  <Text style={styles.optionTxt}>{st}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <LeadDetailModal
        lead={detailModal.lead}
        rowNumber={detailModal.rowNumber}
        user={user}
        onClose={() => setDetailModal({ lead: null, rowNumber: null })}
        onStatusSelect={(lead, st) => setStatusModal({ lead, status: st })}
        onOpenReceipt={(lead) => setReceiptLead(lead)}
        onOpenCharityConfirm={(lead) => setCharityLead(lead)}
        onOpenCallAction={(lead) => setCallActionLead(lead)}
        onDelete={handleDeleteLead}
      />

      <LeadStatusModal
        lead={statusModal.lead}
        newStatus={statusModal.status}
        onClose={() => setStatusModal({ lead: null, status: null })}
        onSave={handleSaveStatus}
        submitting={submitting}
      />

      <ReceiptUploadModal
        lead={receiptLead}
        onClose={() => setReceiptLead(null)}
        onSuccess={() => {
          fetchLeads(true, pageRef.current);
          showToast('Lead converted successfully from receipt!', 'success');
        }}
      />

      <CharityConfirmModal
        lead={charityLead}
        onClose={() => setCharityLead(null)}
        onSuccess={() => {
          fetchLeads(true, pageRef.current);
          showToast('Lead confirmed by charity!', 'success');
        }}
      />

      <CallActionModal
        lead={callActionLead}
        onClose={() => setCallActionLead(null)}
        onSubmit={handleCallActionSubmit}
      />

      <CreateLeadModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreateLead}
        submitting={submitting}
      />

      <ConversionHistoryModal
        contact={historyModal.contact}
        historyData={historyModal.data}
        loading={historyModal.loading}
        user={user}
        onClose={() => setHistoryModal({ contact: null, data: [], loading: false })}
        onStatusSelect={(lead, st) => setStatusModal({ lead, status: st })}
        onOpenReceipt={(lead) => setReceiptLead(lead)}
        onOpenCharityConfirm={(lead) => setCharityLead(lead)}
        onRefreshHistory={() => {
          if (historyModal.contact) openHistory(historyModal.contact.phone, historyModal.contact.name);
          fetchLeads(true, pageRef.current);
        }}
      />

      <DuplicateLeadModal
        duplicateInfo={duplicateInfo}
        onClose={() => setDuplicateInfo(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  listContent: { padding: 14, paddingBottom: 32 },
  toastBanner: { marginHorizontal: 14, marginTop: 8, padding: 10, borderRadius: 12 },
  toastTxt: { color: '#fff', fontSize: 12.5, fontWeight: '800', textAlign: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  searchRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchWrap: {
    flex: 1,
    height: 44,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: { flex: 1, fontSize: 13.5, color: COLORS.textPrimary },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminBar: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  adminChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
  },
  adminChipTxt: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  horizontalFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
  },
  filterPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterPillTxt: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  filterPillTxtActive: { color: '#ffffff' },
  clearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: COLORS.dangerLight,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  clearChipTxt: { fontSize: 11.5, fontWeight: '700', color: COLORS.danger },
  customLabel: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.6 },
  customAmtInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 10,
    fontSize: 13.5,
    color: COLORS.textPrimary,
  },
  pagerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pagerCount: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600' },
  pagerControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pagerBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerPageTxt: { fontSize: 12, fontWeight: '800', color: COLORS.textPrimary },
  leadCard: { marginBottom: 10, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  serialRow: { alignItems: 'center', gap: 4, paddingTop: 2 },
  serialTxt: { fontSize: 11, fontWeight: '800', color: COLORS.textMuted },
  checkBox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COLORS.borderSlate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  leadName: { fontSize: 15.5, fontWeight: '800', color: COLORS.textPrimary },
  leadPhone: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  amountText: { fontSize: 16, fontWeight: '900', color: COLORS.success },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  statusSelectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusSelectTxt: { fontSize: 11, fontWeight: '800' },
  charityTriggerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.success,
    backgroundColor: COLORS.successLight,
  },
  charityTriggerTxt: { fontSize: 11, fontWeight: '800', color: COLORS.success },
  convHistoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: COLORS.violetLight,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
  },
  convHistoryTxt: { fontSize: 11, fontWeight: '800', color: COLORS.violet },
  remarksLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  remarksTxt: { flex: 1, fontSize: 12, color: COLORS.textSecondary },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 2 },
  dateText: { fontSize: 11, color: COLORS.textMuted },
  quickIcons: { flexDirection: 'row', gap: 8 },
  miniBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%', padding: 18 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  pickerTitle: { fontSize: 16.5, fontWeight: '800', color: COLORS.textPrimary },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  optionRowActive: { backgroundColor: COLORS.primaryLight },
  optionTxt: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  optionTxtActive: { color: COLORS.primary },
});

export default MyLeadsScreen;
