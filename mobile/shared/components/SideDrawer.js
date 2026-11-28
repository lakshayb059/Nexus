import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  Animated,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { COLORS, GRADIENTS } from '../theme';
import { getNameInitials } from './UI';
import { LogOut, ChevronRight, X } from 'lucide-react-native';

const DRAWER_WIDTH = Math.min(310, Math.round(Dimensions.get('window').width * 0.82));

export function getProfileAvatarKey(user) {
  const uid = user?._id || user?.id || user?.username || 'default';
  return `nexus_avatar_${String(uid).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

const SideDrawer = ({
  visible,
  onClose,
  user,
  items = [],
  activeRoute,
  onNavigate,
  onOpenProfile,
  onLogout,
  avatarRefreshKey = 0,
}) => {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(visible);
  const [localAvatar, setLocalAvatar] = useState(null);

  useEffect(() => {
    if (!user) return;
    SecureStore.getItemAsync(getProfileAvatarKey(user))
      .then((uri) => setLocalAvatar(uri || null))
      .catch(() => {});
  }, [user, visible, avatarRefreshKey]);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 70,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => setRendered(false));
    }
  }, [visible]);

  if (!rendered) return null;

  const avatarUri = user?.avatar || user?.profileImage || user?.image || localAvatar;
  const initials = getNameInitials(user?.name || user?.username);
  const roleLabel =
    user?.role === 'superadmin'
      ? 'Super Admin'
      : user?.role === 'admin'
      ? 'Admin'
      : user?.role === 'tl'
      ? 'Team Leader'
      : 'Agent';

  return (
    <Modal visible={rendered} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.drawer,
            {
              width: DRAWER_WIDTH,
              paddingTop: Math.max(insets.top, 14),
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          {/* Top Staff Face / Avatar Section - Tap to open Profile */}
          <LinearGradient
            colors={GRADIENTS.nexusBg}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.profileHeader}
          >
            <TouchableOpacity onPress={onClose} style={styles.closeIconBtn} accessibilityLabel="Close menu">
              <X size={18} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                onClose();
                if (onOpenProfile) onOpenProfile();
              }}
              style={styles.profileTouch}
            >
              <View style={styles.avatarRing}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
                ) : (
                  <LinearGradient
                    colors={GRADIENTS.primaryCta}
                    style={styles.initialsCircle}
                  >
                    <Text style={styles.initialsText}>{initials}</Text>
                  </LinearGradient>
                )}
                <View style={styles.activeDot} />
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.userName} numberOfLines={1}>
                  {user?.name || user?.username || 'Staff Member'}
                </Text>
                <Text style={styles.userEmail} numberOfLines={1}>
                  {user?.email || user?.username || ''}
                </Text>
                <View style={styles.roleRow}>
                  <View style={styles.rolePill}>
                    <Text style={styles.rolePillText}>{roleLabel}</Text>
                  </View>
                  <Text style={styles.viewProfileHint}>View Profile →</Text>
                </View>
              </View>
            </TouchableOpacity>
          </LinearGradient>

          {/* Navigation Items (All Pages) */}
          <ScrollView
            style={styles.navScroll}
            contentContainerStyle={styles.navList}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionLabel}>NAVIGATION</Text>
            {items.map((item) => {
              const Icon = item.icon;
              const active = activeRoute === item.route;
              return (
                <TouchableOpacity
                  key={item.key || item.route}
                  activeOpacity={0.78}
                  onPress={() => {
                    onClose();
                    if (onNavigate) onNavigate(item.route, item.subTab);
                  }}
                  style={[styles.navItem, active && styles.navItemActive]}
                >
                  <View style={[styles.navIconWrap, active && styles.navIconWrapActive]}>
                    {Icon && <Icon size={18} color={active ? '#ffffff' : COLORS.textSecondary} />}
                  </View>
                  <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <ChevronRight size={15} color={active ? COLORS.primary : COLORS.textMuted} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Footer: Logout Button ONLY */}
          <View style={styles.footer}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                onClose();
                if (onLogout) onLogout();
              }}
              style={styles.logoutBtn}
            >
              <LogOut size={18} color="#ffffff" />
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.56)',
  },
  drawer: {
    backgroundColor: '#ffffff',
    height: '100%',
    shadowColor: '#020617',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 16,
  },
  profileHeader: {
    marginHorizontal: 12,
    borderRadius: 18,
    padding: 16,
    paddingTop: 14,
    marginBottom: 8,
    position: 'relative',
  },
  closeIconBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  profileTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 22,
  },
  avatarRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: 'rgba(34, 211, 238, 0.7)',
    padding: 2,
    position: 'relative',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
  },
  initialsCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  activeDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#0b224f',
  },
  userName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  userEmail: {
    fontSize: 11.5,
    color: 'rgba(226, 232, 240, 0.78)',
    marginTop: 1,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 7,
    flexWrap: 'wrap',
  },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
    backgroundColor: 'rgba(34, 211, 238, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#e0f2fe',
    textTransform: 'uppercase',
  },
  viewProfileHint: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#67e8f9',
  },
  navScroll: {
    flex: 1,
  },
  navList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 5,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginLeft: 8,
    marginBottom: 4,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  navItemActive: {
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.18)',
  },
  navIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconWrapActive: {
    backgroundColor: COLORS.primary,
  },
  navLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  navLabelActive: {
    color: COLORS.primaryDark,
    fontWeight: '800',
  },
  footer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.danger,
    paddingVertical: 13,
    borderRadius: 12,
  },
  logoutText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '800',
  },
});

export default SideDrawer;
