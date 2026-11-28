import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, GRADIENTS, SHADOWS } from '../theme';
import { Bell, Menu } from 'lucide-react-native';

export function getNameInitials(name) {
  const clean = String(name || 'User').trim();
  if (!clean) return 'U';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

export function formatDateTime(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDateOnly(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function getContactField(fields = {}, candidates = []) {
  if (!fields || typeof fields !== 'object') return '';
  for (const key of candidates) {
    if (fields[key] !== undefined && fields[key] !== null && String(fields[key]).trim() !== '') {
      return String(fields[key]).trim();
    }
  }
  const lowerKeys = Object.keys(fields);
  for (const c of candidates) {
    const match = lowerKeys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (match && fields[match]) return String(fields[match]).trim();
  }
  return '';
}

export function getContactName(fields) {
  return getContactField(fields, ['Name', 'name', 'Full Name', 'full_name', 'Client', 'Donor']) || 'Contact';
}

export function getContactPhone(fields) {
  return getContactField(fields, ['Phone', 'phone', 'Mobile', 'mobile', 'Phone Number', 'Contact', 'WhatsApp']);
}

export function getContactEmail(fields) {
  return getContactField(fields, ['Email', 'email', 'E-mail', 'Mail']);
}

export async function openDialer(phone) {
  if (!phone) {
    Alert.alert('No Phone Number', 'This contact does not have a phone number.');
    return;
  }
  const cleaned = String(phone).replace(/[^\d+]/g, '');
  const url = `tel:${cleaned}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Dialer Error', 'Unable to open phone dialer on this device.');
  }
}

export async function openWhatsApp(phone, message = '') {
  if (!phone) {
    Alert.alert('No Phone Number', 'This contact does not have a phone number.');
    return;
  }
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  const encoded = message ? `?text=${encodeURIComponent(message)}` : '';
  const url = `https://wa.me/${digits}${encoded}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('WhatsApp Error', 'Unable to open WhatsApp on this device.');
  }
}

export const GlassCard = ({ children, style }) => (
  <View style={[styles.glassCard, style]}>{children}</View>
);

export const StatCard = ({ title, value, subtext, icon: Icon, accent = COLORS.primary, style }) => (
  <View style={[styles.statCard, style]}>
    <View style={styles.statTextWrap}>
      <Text style={styles.statTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{String(value ?? 0)}</Text>
      {!!subtext && <Text style={styles.statSubtext} numberOfLines={1}>{subtext}</Text>}
    </View>
    {Icon && (
      <View style={[styles.statIconBox, { backgroundColor: `${accent}18` }]}>
        <Icon size={20} color={accent} strokeWidth={2.2} />
      </View>
    )}
  </View>
);

export const GradientButton = ({
  title,
  onPress,
  loading = false,
  disabled = false,
  colors = GRADIENTS.primaryCta,
  icon: Icon,
  style,
}) => (
  <TouchableOpacity
    activeOpacity={0.85}
    onPress={onPress}
    disabled={disabled || loading}
    style={[{ borderRadius: 12, overflow: 'hidden', opacity: disabled ? 0.6 : 1 }, SHADOWS.primary, style]}
  >
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.ctaGradient}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" size="small" />
      ) : (
        <View style={styles.ctaRow}>
          {Icon && <Icon size={17} color="#ffffff" />}
          <Text style={styles.ctaText}>{title}</Text>
        </View>
      )}
    </LinearGradient>
  </TouchableOpacity>
);

export const Badge = ({ label, color = COLORS.primary, bg = COLORS.primaryLight, style }) => (
  <View style={[styles.badge, { backgroundColor: bg, borderColor: `${color}30` }, style]}>
    <Text style={[styles.badgeText, { color }]}>{label}</Text>
  </View>
);

export const EmptyState = ({ icon: Icon, title, subtitle, action }) => (
  <GlassCard style={styles.emptyCard}>
    {Icon && <Icon size={44} color={COLORS.textMuted} style={{ opacity: 0.4, marginBottom: 12 }} />}
    <Text style={styles.emptyTitle}>{title}</Text>
    {!!subtitle && <Text style={styles.emptySubtitle}>{subtitle}</Text>}
    {action}
  </GlassCard>
);

export const AppTopBar = ({
  title = 'Dashboard',
  unreadCount = 0,
  onPressBell,
  onPressMenu,
}) => {
  return (
    <View style={styles.topBar}>
      <View style={styles.topBarLeft}>
        {onPressMenu && (
          <TouchableOpacity
            onPress={onPressMenu}
            style={styles.menuBtn}
            accessibilityLabel="Open navigation menu"
          >
            <Menu size={20} color={COLORS.textPrimary} strokeWidth={2.3} />
          </TouchableOpacity>
        )}
        <View style={styles.breadcrumbWrap}>
          <Text style={styles.topBarPrefix}>Nexus/</Text>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <View style={styles.topBarActions}>
        {onPressBell && (
          <TouchableOpacity onPress={onPressBell} style={styles.iconBtn} accessibilityLabel="Notifications">
            <Bell size={19} color={COLORS.textSecondary} />
            {unreadCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  glassCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  statCard: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    ...SHADOWS.card,
  },
  statTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  statTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  statValue: {
    fontSize: 21,
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  statSubtext: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  statIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaGradient: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ctaText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyCard: {
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
  topBar: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  topBarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breadcrumbWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    minWidth: 0,
  },
  topBarPrefix: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primary,
  },
  topBarTitle: {
    flexShrink: 1,
    fontSize: 16.5,
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bellBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
