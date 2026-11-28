import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthProvider, useAuth } from '../shared/contexts/AuthContext';
import { SocketProvider, useSocket } from '../shared/contexts/SocketContext';
import api from '../shared/services/api';
import {
  requestPhoneNotificationPermission,
  getPhoneNotificationPermission,
  sendLocalPhoneNotification,
  addNotificationResponseListener,
} from '../shared/services/notifications';
import { COLORS } from '../shared/theme';
import { AppTopBar } from '../shared/components/UI';
import AnimatedSplash from '../shared/components/AnimatedSplash';
import SideDrawer from '../shared/components/SideDrawer';
import NotificationsModal from '../shared/components/NotificationsModal';
import LoginScreen from '../shared/screens/LoginScreen';
import DashboardScreen from '../shared/screens/DashboardScreen';
import UsersScreen from '../shared/screens/UsersScreen';
import MyLeadsScreen from '../shared/screens/MyLeadsScreen';
import ContactsScreen from '../shared/screens/ContactsScreen';
import ScheduleScreen from '../shared/screens/ScheduleScreen';
import AgentLogsScreen from '../shared/screens/AgentLogsScreen';
import UploadScreen from '../shared/screens/UploadScreen';
import ReportsScreen from '../shared/screens/ReportsScreen';
import ProfileScreen from '../shared/screens/ProfileScreen';
import {
  LayoutDashboard,
  Users,
  Star,
  Database,
  Calendar,
  Activity,
  UploadCloud,
  BarChart2,
  UserCircle,
} from 'lucide-react-native';

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();
const ADMIN_LOGO = require('./assets/nexus-logo.png');

SplashScreen.preventAutoHideAsync().catch(() => {});

const AdminPipelineHub = ({ activeSubTab }) => {
  const [subTab, setSubTab] = useState(activeSubTab || 'leads');
  useEffect(() => {
    if (activeSubTab) setSubTab(activeSubTab);
  }, [activeSubTab]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgBase }}>
      <View style={styles.subTabBar}>
        {[
          { key: 'leads', label: 'Leads', Icon: Star },
          { key: 'contacts', label: 'Contacts', Icon: Database },
          { key: 'schedule', label: 'Schedule', Icon: Calendar },
        ].map(({ key, label, Icon }) => {
          const active = subTab === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setSubTab(key)}
              style={[styles.subTabBtn, active && styles.subTabActive]}
            >
              <Icon size={14} color={active ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.subTabTxt, active && styles.subTabTxtActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {subTab === 'leads' ? (
        <MyLeadsScreen />
      ) : subTab === 'contacts' ? (
        <ContactsScreen />
      ) : (
        <ScheduleScreen includeHungUp />
      )}
    </View>
  );
};

const AdminOpsHub = ({ activeSubTab }) => {
  const [subTab, setSubTab] = useState(activeSubTab || 'logs');
  useEffect(() => {
    if (activeSubTab) setSubTab(activeSubTab);
  }, [activeSubTab]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgBase }}>
      <View style={styles.subTabBar}>
        <TouchableOpacity
          onPress={() => setSubTab('logs')}
          style={[styles.subTabBtn, subTab === 'logs' && styles.subTabActive]}
        >
          <Activity size={14} color={subTab === 'logs' ? '#fff' : COLORS.textSecondary} />
          <Text style={[styles.subTabTxt, subTab === 'logs' && styles.subTabTxtActive]}>Agent Logs</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSubTab('upload')}
          style={[styles.subTabBtn, subTab === 'upload' && styles.subTabActive]}
        >
          <UploadCloud size={14} color={subTab === 'upload' ? '#fff' : COLORS.textSecondary} />
          <Text style={[styles.subTabTxt, subTab === 'upload' && styles.subTabTxtActive]}>Data Import</Text>
        </TouchableOpacity>
      </View>
      {subTab === 'logs' ? <AgentLogsScreen /> : <UploadScreen />}
    </View>
  );
};

const AdminShell = () => {
  const { user, logout, recordActivity } = useAuth();
  const { socket } = useSocket();
  const insets = useSafeAreaInsets();

  const [activeRoute, setActiveRoute] = useState('Dashboard');
  const [activeTitle, setActiveTitle] = useState('Dashboard');
  const [pipelineSubTab, setPipelineSubTab] = useState('leads');
  const [opsSubTab, setOpsSubTab] = useState('logs');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifPerm, setNotifPerm] = useState({ granted: true, canAskAgain: true });
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0);

  const navigateTo = (routeName, subTab) => {
    if (routeName === 'Pipeline' && subTab) setPipelineSubTab(subTab);
    if (routeName === 'Ops' && subTab) setOpsSubTab(subTab);
    if (navigationRef.isReady()) {
      navigationRef.navigate(routeName);
    }
  };

  useEffect(() => {
    if (!user) return;
    requestPhoneNotificationPermission().then((res) => setNotifPerm(res));
    const sub = addNotificationResponseListener((data) => {
      if (data?.route) navigateTo(data.route);
    });
    return () => sub?.remove?.();
  }, [user]);

  useEffect(() => {
    if (notifOpen) {
      getPhoneNotificationPermission().then((res) => setNotifPerm(res));
    }
  }, [notifOpen]);

  useEffect(() => {
    if (!user) return;
    api.get('/contacts/notifications')
      .then((res) => {
        const past = (res.data || []).map((a, i) => ({
          id: `past_${Date.now()}_${i}`,
          type: a.type,
          title: a.title,
          message: a.message,
          time: new Date(),
          path: 'Pipeline',
        }));
        setNotifications(past.slice(0, 25));
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!socket) return;
    const onBatch = (data) => {
      const title = 'Batch Uploaded';
      const message = data?.batchName ? `Imported ${data.batchName}` : 'New contact batch imported';
      setNotifications((prev) => [
        {
          id: `batch_${Date.now()}`,
          type: 'workflow',
          title,
          message,
          time: new Date(),
          path: 'Ops',
        },
        ...prev,
      ].slice(0, 25));
      sendLocalPhoneNotification({ title, body: message, data: { route: 'Ops' } });
    };
    const onLead = () => {
      const title = 'Lead Activity';
      const message = 'A new lead or conversion was updated.';
      setNotifications((prev) => [
        {
          id: `lead_${Date.now()}`,
          type: 'lead',
          title,
          message,
          time: new Date(),
          path: 'Pipeline',
        },
        ...prev,
      ].slice(0, 25));
      sendLocalPhoneNotification({ title, body: message, data: { route: 'Pipeline' } });
    };
    socket.on('batch_uploaded', onBatch);
    socket.on('lead_disposed', onLead);
    return () => {
      socket.off('batch_uploaded', onBatch);
      socket.off('lead_disposed', onLead);
    };
  }, [socket]);

  const drawerItems = [
    { key: 'Dashboard', route: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'Users', route: 'Users', label: 'User Management', icon: Users },
    { key: 'Leads', route: 'Pipeline', subTab: 'leads', label: 'Leads', icon: Star },
    { key: 'Contacts', route: 'Pipeline', subTab: 'contacts', label: 'Contacts', icon: Database },
    { key: 'Schedule', route: 'Pipeline', subTab: 'schedule', label: 'Schedule', icon: Calendar },
    { key: 'Logs', route: 'Ops', subTab: 'logs', label: 'Agent Logs', icon: Activity },
    { key: 'Upload', route: 'Ops', subTab: 'upload', label: 'Data Import', icon: UploadCloud },
    { key: 'Reports', route: 'Reports', label: 'Reports & Export', icon: BarChart2 },
    { key: 'Profile', route: 'Profile', label: 'My Profile & Stats', icon: UserCircle },
  ];

  const bottomPadding = Math.max(insets.bottom, 10);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }} edges={['top']} onTouchStart={recordActivity}>
      <StatusBar style="dark" />
      <AppTopBar
        title={activeTitle}
        unreadCount={notifications.length}
        onPressMenu={() => setDrawerOpen(true)}
        onPressBell={() => setNotifOpen(true)}
      />

      <NavigationContainer ref={navigationRef} onStateChange={recordActivity}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: COLORS.primary,
            tabBarInactiveTintColor: COLORS.textMuted,
            tabBarHideOnKeyboard: true,
            tabBarStyle: {
              borderTopColor: COLORS.border,
              borderTopWidth: 1,
              backgroundColor: '#ffffff',
              height: 58 + bottomPadding,
              paddingBottom: bottomPadding,
              paddingTop: 6,
              elevation: 14,
            },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
          }}
        >
          <Tab.Screen
            name="Dashboard"
            listeners={{
              focus: () => {
                setActiveRoute('Dashboard');
                setActiveTitle('Dashboard');
              },
            }}
            options={{
              tabBarLabel: 'Home',
              tabBarIcon: ({ color, size }) => <LayoutDashboard size={size} color={color} />,
            }}
            component={DashboardScreen}
          />

          <Tab.Screen
            name="Users"
            listeners={{
              focus: () => {
                setActiveRoute('Users');
                setActiveTitle('Users');
              },
            }}
            options={{
              tabBarLabel: 'Users',
              tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
            }}
            component={UsersScreen}
          />

          <Tab.Screen
            name="Pipeline"
            listeners={{
              focus: () => {
                setActiveRoute('Pipeline');
                setActiveTitle('Leads');
              },
            }}
            options={{
              tabBarLabel: 'Pipeline',
              tabBarIcon: ({ color, size }) => <Star size={size} color={color} />,
            }}
          >
            {() => <AdminPipelineHub activeSubTab={pipelineSubTab} />}
          </Tab.Screen>

          <Tab.Screen
            name="Ops"
            listeners={{
              focus: () => {
                setActiveRoute('Ops');
                setActiveTitle('Logs');
              },
            }}
            options={{
              tabBarLabel: 'Logs & Data',
              tabBarIcon: ({ color, size }) => <Activity size={size} color={color} />,
            }}
          >
            {() => <AdminOpsHub activeSubTab={opsSubTab} />}
          </Tab.Screen>

          <Tab.Screen
            name="Reports"
            listeners={{
              focus: () => {
                setActiveRoute('Reports');
                setActiveTitle('Reports');
              },
            }}
            options={{
              tabBarLabel: 'Reports',
              tabBarIcon: ({ color, size }) => <BarChart2 size={size} color={color} />,
            }}
            component={ReportsScreen}
          />

          <Tab.Screen
            name="Profile"
            listeners={{
              focus: () => {
                setActiveRoute('Profile');
                setActiveTitle('Profile');
              },
            }}
            options={{
              tabBarButton: () => null,
              tabBarItemStyle: { display: 'none' },
            }}
          >
            {() => <ProfileScreen onAvatarChanged={() => setAvatarRefreshKey((k) => k + 1)} />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>

      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user}
        items={drawerItems}
        activeRoute={activeRoute}
        onNavigate={navigateTo}
        onOpenProfile={() => navigateTo('Profile')}
        onLogout={logout}
        avatarRefreshKey={avatarRefreshKey}
      />

      <NotificationsModal
        visible={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        onClear={() => setNotifications([])}
        onNavigate={(path) => navigateTo(path)}
        permissionGranted={notifPerm.granted}
        canAskPermission={notifPerm.canAskAgain}
        onRequestPermission={async () => {
          const res = await requestPhoneNotificationPermission();
          setNotifPerm(res);
        }}
      />
    </SafeAreaView>
  );
};

const RootGate = () => {
  const { isAuthenticated, loading } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#070d1f' }}>
      <StatusBar style="light" />
      {!splashDone ? (
        <AnimatedSplash
          logoSource={ADMIN_LOGO}
          ready={!loading}
          onReadyToHide={() => SplashScreen.hideAsync().catch(() => {})}
          onFinish={() => setSplashDone(true)}
        />
      ) : isAuthenticated ? (
        <AdminShell />
      ) : (
        <LoginScreen appTitle="Nexus CRM." appBadge="ADMIN CONSOLE • ADMIN & SUPERADMIN" logoSource={ADMIN_LOGO} />
      )}
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider
        allowedRoles={['admin', 'superadmin']}
        appName="Nexus Admin"
        wrongAppMessage="Agent and Team Leader accounts must sign in using the Nexus Staff app."
      >
        <SocketProvider>
          <RootGate />
        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  subTabBar: { flexDirection: 'row', gap: 8, padding: 14, paddingBottom: 4 },
  subTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.borderSlate,
  },
  subTabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  subTabTxt: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  subTabTxtActive: { color: '#fff' },
});
