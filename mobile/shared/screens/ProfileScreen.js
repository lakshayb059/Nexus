import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  TextInput,
  RefreshControl,
  Alert,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import Svg, { Circle, G, Rect, Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../services/api';
import { COLORS, GRADIENTS } from '../theme';
import {
  GlassCard,
  StatCard,
  Badge,
  GradientButton,
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  getNameInitials,
} from '../components/UI';
import { getProfileAvatarKey } from '../components/SideDrawer';
import {
  Camera,
  Mail,
  Shield,
  Calendar,
  PhoneCall,
  Star,
  TrendingUp,
  Clock,
  CheckCircle2,
  Coffee,
  Activity,
  Edit3,
  Users,
  Building2,
  X,
} from 'lucide-react-native';

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtSecs(sec = 0) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

const RingGauge = ({ percent = 0, label, sublabel, color = COLORS.primary }) => {
  const size = 104;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const offset = circ - (clamped / 100) * circ;

  return (
    <View style={styles.gaugeBox}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={`${circ} ${circ}`}
              strokeDashoffset={offset}
              strokeLinecap="round"
              fill="none"
            />
          </G>
        </Svg>
        <View style={styles.gaugeCenter}>
          <Text style={[styles.gaugePct, { color }]}>{clamped}%</Text>
        </View>
      </View>
      <Text style={styles.gaugeLabel}>{label}</Text>
      {!!sublabel && <Text style={styles.gaugeSub}>{sublabel}</Text>}
    </View>
  );
};

const SevenDayTrendChart = ({ data = [], summary = null }) => {
  const [selectedIdx, setSelectedIdx] = useState(null);
  if (!data || data.length === 0) return null;

  const visibleData = data.length > 10 ? data.slice(-10) : data;
  const screenW = Dimensions.get('window').width;
  const chartW = Math.max(260, Math.min(340, screenW - 64));
  const topPad = 24;
  const baselineY = 122;
  const plotH = baselineY - topPad;
  const chartH = baselineY + 26;
  const maxVal = Math.max(1, ...visibleData.map((d) => Math.max(d.calls || 0, d.leads || 0)));
  const colW = chartW / visibleData.length;
  const barW = Math.min(20, Math.max(10, Math.floor(colW * 0.44)));

  const getY = (val) => {
    if (!val || val <= 0) return baselineY - 4;
    return baselineY - Math.max(8, Math.round((val / maxVal) * (plotH - 6)));
  };

  const linePoints = visibleData
    .map((d, i) => `${(i * colW + colW / 2).toFixed(1)},${getY(d.leads).toFixed(1)}`)
    .join(' ');

  const activeItem =
    selectedIdx !== null && visibleData[selectedIdx]
      ? visibleData[selectedIdx]
      : visibleData[visibleData.length - 1];

  return (
    <View style={{ alignItems: 'center' }}>
      {summary && (
        <View style={styles.trendSummaryRow}>
          <View style={styles.trendSummaryChip}>
            <Text style={styles.trendSumLbl}>Calls ({summary.days}d)</Text>
            <Text style={[styles.trendSumVal, { color: '#2563eb' }]}>{summary.totalCalls}</Text>
          </View>
          <View style={styles.trendSummaryChip}>
            <Text style={styles.trendSumLbl}>Leads</Text>
            <Text style={[styles.trendSumVal, { color: '#10b981' }]}>{summary.totalLeads}</Text>
          </View>
          <View style={styles.trendSummaryChip}>
            <Text style={styles.trendSumLbl}>Converted</Text>
            <Text style={[styles.trendSumVal, { color: '#7c3aed' }]}>{summary.totalConverted}</Text>
          </View>
          <View style={styles.trendSummaryChip}>
            <Text style={styles.trendSumLbl}>Revenue</Text>
            <Text style={[styles.trendSumVal, { color: '#0891b2' }]} numberOfLines={1}>
              {formatCurrency(summary.totalRevenue)}
            </Text>
          </View>
        </View>
      )}

      <Svg width={chartW} height={chartH}>
        {[0, 0.5, 1].map((ratio) => {
          const gy = topPad + plotH * (1 - ratio);
          return (
            <Line
              key={`grid-${ratio}`}
              x1={6}
              y1={gy}
              x2={chartW - 6}
              y2={gy}
              stroke="#e2e8f0"
              strokeWidth="1"
              strokeDasharray={ratio === 0 ? undefined : '3,3'}
            />
          );
        })}

        {visibleData.map((d, i) => {
          const cx = i * colW + colW / 2;
          const barY = getY(d.calls);
          const barH = Math.max(4, baselineY - barY);
          const dotY = getY(d.leads);
          const labelY = Math.max(12, Math.min(barY, dotY) - 9);
          const isSel = activeItem?.day === d.day;

          return (
            <G key={d.day} onPress={() => setSelectedIdx(i)}>
              <Rect x={cx - barW / 2} y={topPad} width={barW} height={plotH} rx={5} fill="#f1f5f9" />
              <Rect
                x={cx - barW / 2}
                y={barY}
                width={barW}
                height={barH}
                rx={5}
                fill={isSel ? '#1d4ed8' : '#3b82f6'}
              />
              <SvgText
                x={cx}
                y={labelY}
                fontSize="9.5"
                fontWeight="800"
                fill={isSel ? '#1d4ed8' : COLORS.textPrimary}
                textAnchor="middle"
              >
                {d.calls}
              </SvgText>
              <SvgText
                x={cx}
                y={baselineY + 16}
                fontSize="9.5"
                fontWeight={isSel ? '800' : '700'}
                fill={isSel ? COLORS.primary : COLORS.textMuted}
                textAnchor="middle"
              >
                {d.label}
              </SvgText>
            </G>
          );
        })}

        <Polyline points={linePoints} fill="none" stroke="#10b981" strokeWidth="2.2" />
        {visibleData.map((d, i) => {
          const cx = i * colW + colW / 2;
          const cy = getY(d.leads);
          return (
            <Circle
              key={`pt-${d.day}`}
              cx={cx}
              cy={cy}
              r="3.8"
              fill="#10b981"
              stroke="#ffffff"
              strokeWidth="1.4"
            />
          );
        })}
      </Svg>

      {activeItem && (
        <View style={styles.selectedDayBanner}>
          <Text style={styles.selectedDayTitle}>
            {activeItem.label} ({activeItem.shortDate || activeItem.day})
          </Text>
          <Text style={styles.selectedDayStats}>
            {activeItem.calls} calls · {activeItem.leads} leads · {activeItem.converted} converted · {formatCurrency(activeItem.revenue)}
          </Text>
        </View>
      )}

      <View style={styles.trendLegend}>
        <View style={styles.trendLegItem}>
          <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
          <Text style={styles.trendLegTxt}>Calls Handled</Text>
        </View>
        <View style={styles.trendLegItem}>
          <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
          <Text style={styles.trendLegTxt}>Leads Generated</Text>
        </View>
      </View>
    </View>
  );
};

const DonutBreakdown = ({ segments }) => {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 136;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  let acc = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((seg) => {
      const frac = total > 0 ? seg.value / total : 0;
      const len = frac * circ;
      const dashOffset = -acc;
      acc += len;
      return { ...seg, len, dashOffset };
    });

  return (
    <View style={styles.donutWrap}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
            {arcs.map((a) => (
              <Circle
                key={a.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={a.color}
                strokeWidth={stroke}
                strokeDasharray={`${a.len} ${circ}`}
                strokeDashoffset={a.dashOffset}
                fill="none"
              />
            ))}
          </G>
        </Svg>
        <View style={styles.gaugeCenter}>
          <Text style={styles.donutTotalVal}>{total}</Text>
          <Text style={styles.donutTotalLbl}>TOTAL</Text>
        </View>
      </View>

      <View style={styles.legendCol}>
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
          return (
            <View key={seg.label} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>{seg.label}</Text>
              <Text style={styles.legendVal}>{seg.value} ({pct}%)</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const PerformanceBarChart = ({ bars }) => {
  const maxVal = Math.max(1, ...bars.map((b) => b.value));
  const chartW = Math.max(260, Math.min(330, Dimensions.get('window').width - 64));
  const topPad = 20;
  const baselineY = 122;
  const plotH = baselineY - topPad;
  const barW = Math.min(34, Math.floor((chartW - 24) / Math.max(1, bars.length)) - 10);
  const gap = (chartW - bars.length * barW) / (bars.length + 1);

  return (
    <View style={{ alignItems: 'center', marginTop: 4 }}>
      <Svg width={chartW} height={baselineY + 26}>
        {bars.map((b, idx) => {
          const x = gap + idx * (barW + gap);
          const h = b.value > 0 ? Math.max(8, Math.round((b.value / maxVal) * (plotH - 4))) : 4;
          const y = baselineY - h;
          return (
            <G key={b.label}>
              <Rect x={x} y={topPad} width={barW} height={plotH} rx={7} fill="#f1f5f9" />
              <Rect x={x} y={y} width={barW} height={h} rx={7} fill={b.color} />
              <SvgText x={x + barW / 2} y={Math.max(12, y - 6)} fontSize="10" fontWeight="800" fill={COLORS.textPrimary} textAnchor="middle">
                {b.value}
              </SvgText>
              <SvgText x={x + barW / 2} y={baselineY + 16} fontSize="9.5" fontWeight="700" fill={COLORS.textMuted} textAnchor="middle">
                {b.label}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
};

const ProfileScreen = ({ onAvatarChanged }) => {
  const { user, updateUser, activeBreak, setActiveBreak } = useAuth();
  const { socket } = useSocket();

  const [avatarUri, setAvatarUri] = useState(null);
  const [preset, setPreset] = useState('all');
  const [stats, setStats] = useState(null);
  const [leadStats, setLeadStats] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [liveTick, setLiveTick] = useState(Date.now());

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setLiveTick(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user) return;
    SecureStore.getItemAsync(getProfileAvatarKey(user))
      .then((uri) => setAvatarUri(uri || null))
      .catch(() => {});
  }, [user]);

  const getDateQueries = useCallback(() => {
    const now = new Date();
    if (preset === 'today') {
      const s = fmtDate(now);
      return {
        contactQs: `?fromDate=${s}&toDate=${s}`,
        leadQs: `?convertedFrom=${s}&convertedTo=${s}`,
        trendDays: 7,
      };
    }
    if (preset === '7d') {
      const past = new Date();
      past.setDate(now.getDate() - 6);
      const from = fmtDate(past);
      const to = fmtDate(now);
      return {
        contactQs: `?fromDate=${from}&toDate=${to}`,
        leadQs: `?convertedFrom=${from}&convertedTo=${to}`,
        trendDays: 7,
      };
    }
    if (preset === '30d') {
      const past = new Date();
      past.setDate(now.getDate() - 29);
      const from = fmtDate(past);
      const to = fmtDate(now);
      return {
        contactQs: `?fromDate=${from}&toDate=${to}`,
        leadQs: `?convertedFrom=${from}&convertedTo=${to}`,
        trendDays: 10,
      };
    }
    return { contactQs: '', leadQs: '', trendDays: 7 };
  }, [preset]);

  const fetchProfileStats = useCallback(async (silent = false, forceFresh = false) => {
    if (!silent) setLoading(true);
    try {
      const { contactQs, leadQs, trendDays } = getDateQueries();
      const refreshParam = forceFresh ? 'refresh=true' : '';
      const cUrl = `/contacts/stats${contactQs}${refreshParam ? (contactQs ? `&${refreshParam}` : `?${refreshParam}`) : ''}`;
      const pUrl = `/users/profile?trendDays=${trendDays}${refreshParam ? `&${refreshParam}` : ''}`;

      const [cRes, lRes, pRes] = await Promise.all([
        api.get(cUrl),
        api.get(`/leads/stats${leadQs}`),
        api.get(pUrl),
      ]);

      setStats(cRes.data || {});
      setLeadStats(lRes.data || {});
      if (pRes.data) {
        setProfileData(pRes.data);
        if (pRes.data.user) {
          await updateUser(pRes.data.user);
        }
      }
    } catch {
      // Keep existing values on transient network hiccup
    } finally {
      setLoading(false);
    }
  }, [getDateQueries]);

  useEffect(() => {
    fetchProfileStats();
  }, [fetchProfileStats]);

  useEffect(() => {
    if (!socket) return;
    const events = [
      'contact_disposed',
      'lead_disposed',
      'lead_created',
      'lead_updated',
      'users_updated',
      'contacts_updated',
      'dashboard_update',
      'agent_status_changed',
      'batch_uploaded',
    ];
    const handler = () => fetchProfileStats(true, true);
    events.forEach((e) => socket.on(e, handler));
    return () => events.forEach((e) => socket.off(e, handler));
  }, [socket, fetchProfileStats]);

  const handlePickPhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        const uri = res.assets[0].uri;
        setAvatarUri(uri);
        await SecureStore.setItemAsync(getProfileAvatarKey(user), uri);
        if (onAvatarChanged) onAvatarChanged();
      }
    } catch {
      Alert.alert('Photo Error', 'Could not update profile photo.');
    }
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert('Required', 'Full name cannot be empty.');
      return;
    }
    setSavingEdit(true);
    try {
      const res = await api.put('/users/profile', {
        name: editName.trim(),
        ...(editEmail.trim() ? { email: editEmail.trim() } : {}),
      });
      if (res.data?.user) {
        await updateUser(res.data.user);
      }
      setEditOpen(false);
      fetchProfileStats(true);
      Alert.alert('Profile Updated', 'Your profile details have been saved.');
    } catch (err) {
      Alert.alert('Update Error', err.response?.data?.error || 'Could not update profile.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleStartBreak = async (type) => {
    try {
      const res = await api.post('/agent-logs/start-break', { breakType: type });
      setActiveBreak({
        type,
        startTime: res.data?.activeBreakStart || new Date().toISOString(),
      });
      fetchProfileStats(true);
    } catch (err) {
      Alert.alert('Break Error', err.response?.data?.error || 'Could not start break.');
    }
  };

  const liveUser = profileData?.user || user;
  const org = profileData?.organization || {};
  const workLogs = profileData?.workLogs || [];
  const dailyTrend = profileData?.dailyTrend || [];
  const trendSummary = profileData?.trendSummary || null;
  const currentSession = workLogs.find((l) => !l.logoutAt) || workLogs[0];
  const liveShiftSecs = currentSession
    ? currentSession.logoutAt
      ? currentSession.totalWorkTime
      : Math.max(
          0,
          Math.floor((liveTick - new Date(currentSession.loginAt).getTime()) / 1000) -
            ((currentSession.lunchDuration || 0) + (currentSession.bioDuration || 0) + (currentSession.teaDuration || 0))
        )
    : 0;

  const displayImg = liveUser?.avatar || liveUser?.profileImage || liveUser?.image || avatarUri;
  const initials = getNameInitials(liveUser?.name || liveUser?.username);
  const roleLabel =
    liveUser?.role === 'superadmin'
      ? 'Super Admin'
      : liveUser?.role === 'admin'
      ? 'Admin'
      : liveUser?.role === 'tl'
      ? 'Team Leader'
      : 'Agent';

  const total = stats?.total || 0;
  const pending = stats?.pending || 0;
  const disposed = Math.max(0, total - pending);
  const queuePct = total > 0 ? (disposed / total) * 100 : 0;
  const allLeadsCount = stats?.allLead || leadStats?.allLeadsCount || 0;
  const convertedCount = stats?.lead || leadStats?.totalLeads || 0;
  const convRatePct = allLeadsCount > 0 ? (convertedCount / allLeadsCount) * 100 : 0;

  const donutSegments = [
    { label: 'Converted', value: convertedCount, color: '#10b981' },
    { label: 'Callbacks', value: stats?.callBack || 0, color: '#06b6d4' },
    { label: 'Appointments', value: stats?.appointment || 0, color: '#8b5cf6' },
    { label: 'Not Answered', value: stats?.callNotAnswered || 0, color: '#f59e0b' },
    { label: 'Hung Up', value: stats?.hungUp || 0, color: '#f43f5e' },
    { label: 'Not Int. / DNC', value: (stats?.notInterested || 0) + (stats?.doNotCall || 0) + (stats?.invalid || 0), color: '#ef4444' },
    { label: 'Pending', value: pending, color: '#94a3b8' },
  ];

  const barData = [
    { label: 'Total', value: total, color: '#6366f1' },
    { label: 'Disposed', value: disposed, color: '#2563eb' },
    { label: 'Today', value: stats?.todayCalls || 0, color: '#06b6d4' },
    { label: 'Leads', value: allLeadsCount, color: '#8b5cf6' },
    { label: 'Converted', value: convertedCount, color: '#10b981' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => fetchProfileStats()} />}
    >
      {/* Profile Identity Card */}
      <LinearGradient
        colors={GRADIENTS.nexusBg}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View style={styles.heroTop}>
          <TouchableOpacity activeOpacity={0.85} onPress={handlePickPhoto} style={styles.avatarOuter}>
            {displayImg ? (
              <Image source={{ uri: displayImg }} style={styles.avatarImg} />
            ) : (
              <LinearGradient colors={GRADIENTS.primaryCta} style={styles.initialsCircle}>
                <Text style={styles.initialsText}>{initials}</Text>
              </LinearGradient>
            )}
            <View style={styles.cameraBadge}>
              <Camera size={12} color="#ffffff" />
            </View>
          </TouchableOpacity>

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={styles.heroName} numberOfLines={1}>
                {liveUser?.name || liveUser?.username || 'Staff Member'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setEditName(liveUser?.name || '');
                  setEditEmail(liveUser?.email || '');
                  setEditOpen(true);
                }}
                style={styles.editProfileBtn}
              >
                <Edit3 size={13} color="#e0f2fe" />
                <Text style={styles.editProfileTxt}>Edit</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.heroUser}>@{liveUser?.username || 'staff'}</Text>
            <View style={styles.heroBadges}>
              <Badge
                label={roleLabel}
                color="#e0f2fe"
                bg="rgba(34, 211, 238, 0.2)"
                style={{ borderColor: 'rgba(34, 211, 238, 0.4)' }}
              />
              <Badge
                label={liveUser?.active !== false ? 'Active' : 'Inactive'}
                color="#d1fae5"
                bg="rgba(16, 185, 129, 0.22)"
                style={{ borderColor: 'rgba(16, 185, 129, 0.45)' }}
              />
            </View>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoRow}>
            <Mail size={14} color="#67e8f9" />
            <Text style={styles.infoTxt} numberOfLines={1}>
              {liveUser?.email || liveUser?.username || 'No email set'}
            </Text>
          </View>
          {!!org.adminName && (
            <View style={styles.infoRow}>
              <Building2 size={14} color="#a5b4fc" />
              <Text style={styles.infoTxt}>Organization: {org.adminName}</Text>
            </View>
          )}
          {!!org.tlName && (
            <View style={styles.infoRow}>
              <Users size={14} color="#67e8f9" />
              <Text style={styles.infoTxt}>Team Leader: {org.tlName}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Shield size={14} color="#a5b4fc" />
            <Text style={styles.infoTxt}>Role: {roleLabel}</Text>
          </View>
          <View style={styles.infoRow}>
            <Calendar size={14} color="#34d399" />
            <Text style={styles.infoTxt}>Member since {formatDateOnly(liveUser?.createdAt)}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Date Range Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
        {[
          { key: 'all', label: 'All Time' },
          { key: 'today', label: 'Today' },
          { key: '7d', label: 'Last 7 Days' },
          { key: '30d', label: 'Last 30 Days' },
        ].map((p) => (
          <TouchableOpacity
            key={p.key}
            onPress={() => setPreset(p.key)}
            style={[styles.pill, preset === p.key && styles.pillActive]}
          >
            <Text style={[styles.pillText, preset === p.key && styles.pillTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Core KPI Cards */}
      <View style={styles.kpiGrid}>
        <StatCard title="Calls Today" value={stats?.todayCalls || 0} subtext="Disposed today" icon={PhoneCall} accent="#06b6d4" />
        <StatCard title="Disposed Calls" value={disposed} subtext={`${pending} pending`} icon={CheckCircle2} accent="#2563eb" />
        <StatCard title="Converted Leads" value={convertedCount} subtext={`${allLeadsCount} total leads`} icon={Star} accent="#10b981" />
        <StatCard
          title="Revenue"
          value={formatCurrency(stats?.totalLeadAmount ?? leadStats?.totalAmount)}
          subtext="Converted value"
          icon={TrendingUp}
          accent="#8b5cf6"
        />
      </View>

      {/* Efficiency Gauges */}
      <GlassCard>
        <View style={styles.cardHeader}>
          <Activity size={17} color={COLORS.primary} />
          <Text style={styles.cardTitle}>Efficiency & Conversion Rings</Text>
        </View>
        <View style={styles.gaugesRow}>
          <RingGauge percent={queuePct} label="Queue Handled" sublabel={`${disposed} of ${total}`} color={COLORS.primary} />
          <RingGauge percent={convRatePct} label="Lead Conversion" sublabel={`${convertedCount} of ${allLeadsCount}`} color={COLORS.success} />
        </View>
      </GlassCard>

      {/* 7-Day / 10-Day Daily Trend Chart */}
      {dailyTrend.length > 0 && (
        <GlassCard>
          <View style={styles.cardHeader}>
            <TrendingUp size={17} color={COLORS.success} />
            <Text style={styles.cardTitle}>{trendSummary?.days || 7}-Day Performance Trend</Text>
          </View>
          <SevenDayTrendChart data={dailyTrend} summary={trendSummary} />
        </GlassCard>
      )}

      {/* Performance Bar Graph */}
      <GlassCard>
        <View style={styles.cardHeader}>
          <TrendingUp size={17} color={COLORS.violet} />
          <Text style={styles.cardTitle}>Activity Volume Chart</Text>
        </View>
        <PerformanceBarChart bars={barData} />
      </GlassCard>

      {/* Disposition Donut Graph */}
      <GlassCard>
        <View style={styles.cardHeader}>
          <Clock size={17} color={COLORS.cyan} />
          <Text style={styles.cardTitle}>Call Disposition Breakdown</Text>
        </View>
        <DonutBreakdown segments={donutSegments} />
      </GlassCard>

      {/* Agent Break Controller & Recent Work Sessions */}
      {liveUser?.role === 'agent' && (
        <GlassCard style={{ gap: 10 }}>
          <View style={styles.cardHeader}>
            <Coffee size={17} color={COLORS.warning} />
            <Text style={styles.cardTitle}>Work Session & Breaks</Text>
          </View>
          <View style={styles.breakBtnRow}>
            {[
              { key: 'lunch', label: 'Lunch (30m)', color: '#d97706' },
              { key: 'tea', label: 'Tea (15m)', color: '#2563eb' },
              { key: 'bio', label: 'Bio (10m)', color: '#059669' },
            ].map((b) => (
              <TouchableOpacity
                key={b.key}
                onPress={() => handleStartBreak(b.key)}
                disabled={Boolean(activeBreak)}
                style={[styles.breakActionBtn, { borderColor: `${b.color}40`, backgroundColor: `${b.color}10`, opacity: activeBreak ? 0.5 : 1 }]}
              >
                <Text style={[styles.breakActionTxt, { color: b.color }]}>{b.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {currentSession && (
            <>
              <Text style={styles.sessionMeta}>
                Current Shift: {formatDateTime(currentSession.loginAt)}
              </Text>
              <View style={styles.breakStatsRow}>
                <View style={styles.breakChip}>
                  <Text style={styles.breakChipLbl}>Lunch</Text>
                  <Text style={styles.breakChipVal}>{fmtSecs(currentSession.lunchDuration)}</Text>
                </View>
                <View style={styles.breakChip}>
                  <Text style={styles.breakChipLbl}>Tea</Text>
                  <Text style={styles.breakChipVal}>{fmtSecs(currentSession.teaDuration)}</Text>
                </View>
                <View style={styles.breakChip}>
                  <Text style={styles.breakChipLbl}>Bio</Text>
                  <Text style={styles.breakChipVal}>{fmtSecs(currentSession.bioDuration)}</Text>
                </View>
              </View>
            </>
          )}

          {workLogs.length > 0 && (
            <View style={{ marginTop: 4 }}>
              <Text style={styles.subHeading}>RECENT SHIFTS ({workLogs.length})</Text>
              {workLogs.slice(0, 5).map((log) => (
                <View key={log.id} style={styles.logRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.logDate}>{formatDateTime(log.loginAt)}</Text>
                    <Text style={styles.logSub}>
                      {log.logoutAt ? `Out: ${formatDateTime(log.logoutAt)}` : 'Active Session'}
                    </Text>
                  </View>
                  <Badge
                    label={log.logoutAt ? fmtSecs(log.totalWorkTime) : `Live · ${fmtSecs(liveShiftSecs)}`}
                    color={log.logoutAt ? COLORS.primary : COLORS.success}
                    bg={log.logoutAt ? COLORS.primaryLight : COLORS.successLight}
                  />
                </View>
              ))}
            </View>
          )}
        </GlassCard>
      )}

      {/* Edit Profile Modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setEditOpen(false)}><X size={20} color={COLORS.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>FULL NAME *</Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Your full name"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
            <TextInput
              value={editEmail}
              onChangeText={setEditEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="name@company.com"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />
            <GradientButton title="Save Profile" onPress={handleSaveProfile} loading={savingEdit} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  content: { padding: 14, paddingBottom: 32, gap: 12 },
  heroCard: { borderRadius: 20, padding: 18, gap: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2.5,
    borderColor: '#22d3ee',
    padding: 3,
    position: 'relative',
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: 36 },
  initialsCircle: { width: '100%', height: '100%', borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontSize: 26, fontWeight: '900', color: '#ffffff' },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: '#0b224f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: { flex: 1, fontSize: 20, fontWeight: '900', color: '#ffffff' },
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  editProfileTxt: { fontSize: 11, fontWeight: '800', color: '#e0f2fe' },
  heroUser: { fontSize: 12.5, color: 'rgba(224, 242, 254, 0.78)', marginTop: 1 },
  heroBadges: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  infoGrid: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.14)', paddingTop: 12, gap: 7 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoTxt: { fontSize: 12.5, color: 'rgba(241, 245, 249, 0.9)', fontWeight: '600' },
  connRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  connItem: {
    flex: 1,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
    padding: 10,
    gap: 6,
    alignItems: 'flex-start',
  },
  connLabel: { fontSize: 11, fontWeight: '800', color: COLORS.textMuted, textTransform: 'uppercase' },
  enableNotifBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  enableNotifTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  syncNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  syncNowTxt: { fontSize: 11, fontWeight: '800', color: COLORS.primary },
  trendSummaryRow: { flexDirection: 'row', gap: 6, width: '100%', marginBottom: 8 },
  trendSummaryChip: {
    flex: 1,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  trendSumLbl: { fontSize: 9.5, fontWeight: '700', color: COLORS.textMuted },
  trendSumVal: { fontSize: 12.5, fontWeight: '900', marginTop: 1 },
  selectedDayBanner: {
    width: '100%',
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  selectedDayTitle: { fontSize: 11.5, fontWeight: '800', color: COLORS.primary },
  selectedDayStats: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary },
  presetRow: { flexDirection: 'row', gap: 8 },
  pill: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: '#ffffff', borderWidth: 1, borderColor: COLORS.borderSlate },
  pillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  pillTextActive: { color: '#ffffff' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary },
  gaugesRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6 },
  gaugeBox: { alignItems: 'center', gap: 6 },
  gaugeCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  gaugePct: { fontSize: 20, fontWeight: '900' },
  gaugeLabel: { fontSize: 13, fontWeight: '800', color: COLORS.textPrimary },
  gaugeSub: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  trendLegend: { flexDirection: 'row', gap: 16, marginTop: 4 },
  trendLegItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trendLegTxt: { fontSize: 11.5, fontWeight: '700', color: COLORS.textSecondary },
  donutWrap: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  donutTotalVal: { fontSize: 20, fontWeight: '900', color: COLORS.textPrimary },
  donutTotalLbl: { fontSize: 9, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.7 },
  legendCol: { flex: 1, gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { flex: 1, fontSize: 11.5, fontWeight: '600', color: COLORS.textSecondary },
  legendVal: { fontSize: 11.5, fontWeight: '800', color: COLORS.textPrimary },
  breakBtnRow: { flexDirection: 'row', gap: 8 },
  breakActionBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  breakActionTxt: { fontSize: 11.5, fontWeight: '800' },
  sessionMeta: { fontSize: 12.5, color: COLORS.textSecondary },
  breakStatsRow: { flexDirection: 'row', gap: 8 },
  breakChip: {
    flex: 1,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
    padding: 10,
    alignItems: 'center',
  },
  breakChipLbl: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted },
  breakChipVal: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary, marginTop: 2 },
  subHeading: { fontSize: 10.5, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.7, marginBottom: 4 },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  logDate: { fontSize: 12.5, fontWeight: '700', color: COLORS.textPrimary },
  logSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  fieldLabel: { fontSize: 10.5, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 0.6, marginBottom: 5 },
  input: {
    height: 44,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    marginBottom: 14,
  },
});

export default ProfileScreen;
