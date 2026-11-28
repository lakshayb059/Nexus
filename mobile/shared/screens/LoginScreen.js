import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { GradientButton } from '../components/UI';
import { COLORS, GRADIENTS } from '../theme';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ShieldAlert,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react-native';

const LoginScreen = ({ appTitle = 'Nexus CRM.', appBadge = 'WORKSPACE', logoSource }) => {
  const { login, register, forgotPassword } = useAuth();

  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setSuccessMsg('');
    setPassword('');
    setConfirmPassword('');
    setShowPass(false);
  };

  const handleLogin = async () => {
    setError('');
    setSuccessMsg('');
    if (!identifier.trim() || !password) {
      setError('Please enter both work email/username and password.');
      return;
    }
    setLoading(true);
    const res = await login(identifier.trim(), password);
    setLoading(false);
    if (!res.success) {
      setError(res.error);
    }
  };

  const handleRegister = async () => {
    setError('');
    setSuccessMsg('');
    if (!name.trim() || !identifier.trim() || !password) {
      setError('Please fill in all required registration fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const res = await register({
      name: name.trim(),
      email: identifier.trim(),
      password,
    });
    setLoading(false);

    if (res.success) {
      setMode('login');
      setPassword('');
      setConfirmPassword('');
      setSuccessMsg(res.message || 'Account registered successfully.');
    } else {
      setError(res.error);
    }
  };

  const handleForgot = async () => {
    setError('');
    setSuccessMsg('');
    if (!identifier.trim()) {
      setError('Please enter your registered email address.');
      return;
    }
    setLoading(true);
    const res = await forgotPassword(identifier.trim());
    setLoading(false);

    if (res.success) {
      setSuccessMsg(res.message);
    } else {
      setError(res.error);
    }
  };

  const cardHeading =
    mode === 'login'
      ? 'Workspace Access'
      : mode === 'register'
      ? 'Create Workspace Account'
      : 'Reset Workspace Password';

  return (
    <LinearGradient
      colors={GRADIENTS.nexusBg}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.shell}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Top Brand Lockup */}
            <View style={styles.brandHeader}>
              {logoSource && (
                <Image source={logoSource} style={styles.logoImage} resizeMode="contain" />
              )}
              <Text style={styles.brandWordmark}>{appTitle}</Text>
              <View style={styles.appRolePill}>
                <Text style={styles.appRolePillText}>{appBadge}</Text>
              </View>
            </View>

            {/* Crisp White Enterprise Card */}
            <View style={styles.whiteCard}>
              {mode !== 'login' && (
                <View style={styles.cardTopRow}>
                  <View style={styles.modePill}>
                    <Text style={styles.modePillText}>
                      {mode === 'register' ? 'REGISTER' : 'RECOVERY'}
                    </Text>
                  </View>
                </View>
              )}

              <Text style={styles.cardTitle}>{cardHeading}</Text>
              <Text style={styles.cardSubtitle}>
                {mode === 'login'
                  ? 'Enter your authorized enterprise credentials to access your session.'
                  : mode === 'register'
                  ? 'Create your new Nexus CRM workspace account.'
                  : 'Enter your work email to receive a single-use password reset link.'}
              </Text>

              {!!error && (
                <View style={[styles.alertBox, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
                  <ShieldAlert size={16} color={COLORS.danger} />
                  <Text style={[styles.alertText, { color: '#b91c1c' }]}>{error}</Text>
                </View>
              )}

              {!!successMsg && (
                <View style={[styles.alertBox, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}>
                  <CheckCircle2 size={16} color={COLORS.success} />
                  <Text style={[styles.alertText, { color: '#047857' }]}>{successMsg}</Text>
                </View>
              )}

              {mode === 'register' && (
                <View style={styles.fieldBlock}>
                  <Text style={styles.label}>FULL NAME</Text>
                  <View style={styles.inputWrap}>
                    <User size={16} color="#94a3b8" style={styles.leftIcon} />
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      placeholder="Alex Morgan"
                      placeholderTextColor="#94a3b8"
                      style={styles.input}
                      editable={!loading}
                    />
                  </View>
                </View>
              )}

              <View style={styles.fieldBlock}>
                <Text style={styles.label}>
                  {mode === 'login' ? 'WORK EMAIL / USERNAME' : 'WORK EMAIL'}
                </Text>
                <View style={styles.inputWrap}>
                  <Mail size={16} color="#94a3b8" style={styles.leftIcon} />
                  <TextInput
                    value={identifier}
                    onChangeText={setIdentifier}
                    placeholder="name@company.com"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={styles.input}
                    editable={!loading}
                  />
                </View>
              </View>

              {mode !== 'forgot' && (
                <View style={styles.fieldBlock}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>PASSWORD</Text>
                    {mode === 'login' ? (
                      <TouchableOpacity onPress={() => switchMode('forgot')}>
                        <Text style={styles.inlineLink}>Forgot password?</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.hintText}>8+ chars, Aa1!</Text>
                    )}
                  </View>
                  <View style={styles.inputWrap}>
                    <Lock size={16} color="#94a3b8" style={styles.leftIcon} />
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      placeholder="••••••••"
                      placeholderTextColor="#94a3b8"
                      secureTextEntry={!showPass}
                      style={[styles.input, { paddingRight: 42 }]}
                      editable={!loading}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPass((p) => !p)}
                      style={styles.eyeBtn}
                    >
                      {showPass ? <EyeOff size={17} color="#64748b" /> : <Eye size={17} color="#64748b" />}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {mode === 'register' && (
                <View style={styles.fieldBlock}>
                  <Text style={styles.label}>CONFIRM PASSWORD</Text>
                  <View style={styles.inputWrap}>
                    <Lock size={16} color="#94a3b8" style={styles.leftIcon} />
                    <TextInput
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      placeholder="Re-enter password"
                      placeholderTextColor="#94a3b8"
                      secureTextEntry={!showPass}
                      style={styles.input}
                      editable={!loading}
                    />
                  </View>
                </View>
              )}

              <GradientButton
                title={
                  mode === 'login'
                    ? 'Enter Workspace'
                    : mode === 'register'
                    ? 'Create Workspace Account'
                    : 'Send Reset Link'
                }
                loading={loading}
                onPress={
                  mode === 'login'
                    ? handleLogin
                    : mode === 'register'
                    ? handleRegister
                    : handleForgot
                }
                style={{ marginTop: 8 }}
              />

              {mode === 'login' ? (
                <View style={styles.switchRow}>
                  <Text style={styles.switchMuted}>Need a new account? </Text>
                  <TouchableOpacity onPress={() => switchMode('register')}>
                    <Text style={styles.switchLink}>Register</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => switchMode('login')} style={styles.backRow}>
                  <ArrowLeft size={14} color={COLORS.primary} />
                  <Text style={styles.switchLink}>Back to Login</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: 140,
    height: 140,
    marginBottom: 8,
  },
  brandWordmark: {
    fontSize: 34,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.6,
  },
  appRolePill: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  appRolePillText: {
    color: '#e0f2fe',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  whiteCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 22,
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.35,
    shadowRadius: 30,
    elevation: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 12,
  },
  modePill: {
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  modePillText: {
    color: COLORS.primaryDark,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 12.5,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginBottom: 18,
  },
  alertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  alertText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  fieldBlock: {
    marginBottom: 13,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 10.5,
    fontWeight: '800',
    color: COLORS.textSecondary,
    letterSpacing: 0.7,
    marginBottom: 6,
  },
  inlineLink: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 6,
  },
  hintText: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginBottom: 6,
  },
  inputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  leftIcon: {
    position: 'absolute',
    left: 12,
    zIndex: 2,
  },
  input: {
    height: 44,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingLeft: 38,
    paddingRight: 14,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  eyeBtn: {
    position: 'absolute',
    right: 10,
    padding: 6,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 14,
  },
  switchMuted: {
    fontSize: 12.5,
    color: '#475569',
  },
  switchLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.primary,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 14,
  },
});

export default LoginScreen;
