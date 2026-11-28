import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import NexusLogoMark from '../components/NexusLogoMark';
import TurnstileWidget from '../components/TurnstileWidget';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  Mail,
  Lock,
  ArrowLeft,
} from 'lucide-react';

const Login = () => {
  const [mode, setMode] = useState('login'); // 'login' | 'forgot'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileRequired, setTurnstileRequired] = useState(false);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login, forgotPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('expired') === 'true') {
      setError('Your session expired. Please sign in again.');
    }
  }, [location.search]);

  const resetTurnstile = () => {
    setTurnstileToken('');
    setTurnstileResetSignal((n) => n + 1);
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setSuccessMsg('');
    setPassword('');
    setShowPass(false);
    resetTurnstile();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!username.trim() || !password) {
      setError('Please enter both work email/username and password.');
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setError('Please complete the Cloudflare Turnstile security check.');
      return;
    }

    setIsLoading(true);
    const result = await login(username.trim(), password, turnstileToken);
    if (result.success) {
      const targetPath = location.state?.from?.pathname || '/dashboard';
      navigate(targetPath, { replace: true });
    } else {
      setError(result.error);
      setIsLoading(false);
      resetTurnstile();
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!username.trim()) {
      setError('Please enter your registered email address.');
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setError('Please complete the Cloudflare Turnstile security check.');
      return;
    }

    setIsLoading(true);
    const result = await forgotPassword(username.trim(), turnstileToken);
    setIsLoading(false);
    resetTurnstile();

    if (result.success) {
      setSuccessMsg(result.message);
    } else {
      setError(result.error);
    }
  };

  const headingTitle =
    mode === 'login' ? 'Nexus CRM Login' : 'Reset Password';

  const headingSubtitle =
    mode === 'login'
      ? 'Enter your authorized enterprise credentials to access your session.'
      : 'Enter your work email and we will send a single-use password reset link.';

  const turnstileAction = mode === 'login' ? 'login' : 'forgot_password';

  return (
    <div className="nexus-auth-shell">
      <div className="nexus-auth-grid">
        {/* LEFT COLUMN: Crisp White Enterprise Auth Card */}
        <section className="nexus-auth-card" aria-label="Authentication form">
          {mode === 'forgot' && (
            <div className="nexus-card-top">
              <span className="nexus-mode-pill">RECOVERY</span>
            </div>
          )}

          <h1 className="nexus-card-title">{headingTitle}</h1>
          <p className="nexus-card-subtitle">{headingSubtitle}</p>

          {error && (
            <div className="nexus-alert nexus-alert-error" role="alert">
              <ShieldAlert size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="nexus-alert nexus-alert-success" role="status">
              <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
              <span>{successMsg}</span>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="nexus-auth-form">
              <div className="nexus-field-block">
                <div className="nexus-label-row">
                  <label htmlFor="login-username">WORK EMAIL</label>
                </div>
                <div className="nexus-input-wrap">
                  <Mail size={16} className="nexus-input-icon" />
                  <input
                    id="login-username"
                    type="text"
                    className="nexus-input"
                    placeholder="name@nexus.crm"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="nexus-field-block">
                <div className="nexus-label-row">
                  <label htmlFor="login-password">PASSWORD</label>
                  <button
                    type="button"
                    className="nexus-inline-link"
                    onClick={() => switchMode('forgot')}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="nexus-input-wrap">
                  <Lock size={16} className="nexus-input-icon" />
                  <input
                    id="login-password"
                    type={showPass ? 'text' : 'password'}
                    className="nexus-input nexus-input-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="nexus-eye-btn"
                    onClick={() => setShowPass((p) => !p)}
                    aria-label="Toggle password visibility"
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="nexus-turnstile-box">
                <TurnstileWidget
                  action={turnstileAction}
                  resetSignal={turnstileResetSignal}
                  onVerify={(tok) => setTurnstileToken(tok)}
                  onExpire={() => setTurnstileToken('')}
                  onError={() => setTurnstileToken('')}
                  onConfigLoaded={({ enabled }) => setTurnstileRequired(enabled)}
                />
                <div className="nexus-turnstile-caption">
                  <ShieldCheck size={14} color="#059669" />
                  <span>Protected by Cloudflare Turnstile Authentication</span>
                </div>
              </div>

              <button
                id="login-submit"
                type="submit"
                className="nexus-primary-cta"
                disabled={isLoading}
              >
                {isLoading ? <span className="nexus-spinner" /> : 'Enter Workspace'}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="nexus-auth-form">
              <div className="nexus-field-block">
                <div className="nexus-label-row">
                  <label htmlFor="forgot-email">REGISTERED WORK EMAIL</label>
                </div>
                <div className="nexus-input-wrap">
                  <Mail size={16} className="nexus-input-icon" />
                  <input
                    id="forgot-email"
                    type="email"
                    className="nexus-input"
                    placeholder="name@nexus.crm"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className="nexus-turnstile-box">
                <TurnstileWidget
                  action={turnstileAction}
                  resetSignal={turnstileResetSignal}
                  onVerify={(tok) => setTurnstileToken(tok)}
                  onExpire={() => setTurnstileToken('')}
                  onError={() => setTurnstileToken('')}
                  onConfigLoaded={({ enabled }) => setTurnstileRequired(enabled)}
                />
                <div className="nexus-turnstile-caption">
                  <ShieldCheck size={14} color="#059669" />
                  <span>Protected by Cloudflare Turnstile Authentication</span>
                </div>
              </div>

              <button
                id="forgot-submit"
                type="submit"
                className="nexus-primary-cta"
                disabled={isLoading}
              >
                {isLoading ? <span className="nexus-spinner" /> : 'Send Reset Link'}
              </button>

              <p className="nexus-switch-line">
                <button
                  type="button"
                  className="nexus-inline-link nexus-inline-strong"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  onClick={() => switchMode('login')}
                >
                  <ArrowLeft size={14} /> Back to Login
                </button>
              </p>
            </form>
          )}
        </section>

        {/* RIGHT COLUMN: Centered Nexus Logo Mark & Stacked Brand Wordmark */}
        <aside className="nexus-brand-showcase" aria-label="Nexus CRM brand">
          <div className="nexus-brand-lockup">
            <div className="nexus-logo-badge">
              <NexusLogoMark size={178} />
            </div>
            <div className="nexus-wordmark">
              <span className="nexus-wordmark-line">Nexus</span>
              <span className="nexus-wordmark-line">
                CRM<span className="nexus-wordmark-dot">.</span>
              </span>
            </div>
          </div>
        </aside>
      </div>

      <style>{`
        .nexus-auth-shell {
          min-height: 100vh;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(20px, 4vw, 48px);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background:
            radial-gradient(circle at 82% 24%, rgba(34, 211, 238, 0.34) 0%, transparent 44%),
            radial-gradient(circle at 72% 78%, rgba(124, 58, 237, 0.42) 0%, transparent 48%),
            radial-gradient(circle at 18% 82%, rgba(29, 78, 216, 0.25) 0%, transparent 45%),
            linear-gradient(125deg, #070d1f 0%, #0b224f 36%, #0c4d78 68%, #3c2f96 100%);
          position: relative;
          overflow-x: hidden;
        }

        .nexus-auth-grid {
          width: 100%;
          max-width: 1080px;
          display: grid;
          grid-template-columns: minmax(340px, 420px) 1fr;
          align-items: center;
          gap: clamp(32px, 6vw, 96px);
          z-index: 2;
        }

        /* ── Crisp White Left Card ── */
        .nexus-auth-card {
          background: #ffffff;
          border-radius: 22px;
          padding: 30px 30px 20px;
          box-shadow:
            0 32px 75px -16px rgba(2, 6, 23, 0.58),
            0 0 0 1px rgba(255, 255, 255, 0.14);
          color: #0f172a;
        }

        .nexus-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 18px;
        }

        .nexus-mode-pill {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(79, 70, 229, 0.12));
          color: #1d4ed8;
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .nexus-workspace-label {
          font-size: 0.78rem;
          font-weight: 500;
          color: #64748b;
        }

        .nexus-card-title {
          font-size: 1.52rem;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.025em;
          margin: 0 0 6px;
          line-height: 1.2;
        }

        .nexus-card-subtitle {
          font-size: 0.82rem;
          color: #64748b;
          line-height: 1.45;
          margin: 0 0 22px;
        }

        .nexus-alert {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 16px;
        }

        .nexus-alert-error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
        }

        .nexus-alert-success {
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #047857;
        }

        .nexus-auth-form {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .nexus-field-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .nexus-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .nexus-label-row label {
          font-size: 0.68rem;
          font-weight: 800;
          color: #334155;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .nexus-hint-text {
          font-size: 0.7rem;
          color: #64748b;
          font-weight: 500;
        }

        .nexus-inline-link {
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          font-family: inherit;
          font-size: 0.76rem;
          font-weight: 600;
          color: #2563eb;
          transition: color 0.15s ease;
        }

        .nexus-inline-link:hover {
          color: #1d4ed8;
          text-decoration: underline;
        }

        .nexus-inline-strong {
          font-weight: 700;
        }

        .nexus-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .nexus-input-icon {
          position: absolute;
          left: 13px;
          color: #94a3b8;
          pointer-events: none;
        }

        .nexus-input {
          width: 100%;
          height: 44px;
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          padding: 0 14px 0 39px;
          font-size: 0.88rem;
          color: #0f172a;
          font-family: inherit;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .nexus-input-password {
          padding-right: 40px;
        }

        .nexus-input::placeholder {
          color: #94a3b8;
        }

        .nexus-input:focus {
          outline: none;
          background: #ffffff;
          border-color: #0284c7;
          box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.16);
        }

        .nexus-eye-btn {
          position: absolute;
          right: 11px;
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .nexus-eye-btn:hover {
          color: #0f172a;
        }

        /* ── Cloudflare Turnstile Container ── */
        .nexus-turnstile-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 7px;
          margin-top: 2px;
        }

        .nexus-turnstile-caption {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.72rem;
          color: #475569;
          font-weight: 500;
        }

        /* ── Primary Gradient CTA matching Nexus Logo ── */
        .nexus-primary-cta {
          width: 100%;
          height: 45px;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #0284c7 0%, #2563eb 52%, #6366f1 100%);
          color: #ffffff;
          font-family: inherit;
          font-size: 0.9rem;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 22px rgba(37, 99, 235, 0.34);
          transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
        }

        .nexus-primary-cta:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 12px 28px rgba(6, 182, 212, 0.36);
          filter: brightness(1.04);
        }

        .nexus-primary-cta:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .nexus-spinner {
          width: 18px;
          height: 18px;
          border: 2.5px solid rgba(255, 255, 255, 0.35);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: nexusSpin 0.75s linear infinite;
        }

        @keyframes nexusSpin {
          to { transform: rotate(360deg); }
        }

        .nexus-switch-line {
          margin: 2px 0 0;
          text-align: center;
          font-size: 0.8rem;
          color: #475569;
        }

        .nexus-card-footer {
          margin-top: 20px;
          padding-top: 14px;
          border-top: 1px solid #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.72rem;
        }

        .nexus-footer-security {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #64748b;
          font-weight: 500;
        }

        .nexus-green-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.16);
        }

        .nexus-footer-domain {
          color: #2563eb;
          font-weight: 600;
        }

        /* ── Right Column: Nexus Logo + Stacked Wordmark ── */
        .nexus-brand-showcase {
          display: flex;
          align-items: center;
          justify-content: center;
          user-select: none;
        }

        .nexus-brand-lockup {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .nexus-logo-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
        }

        .nexus-logo-badge img {
          width: clamp(120px, 14vw, 178px) !important;
          height: clamp(120px, 14vw, 178px) !important;
        }

        .nexus-wordmark {
          display: flex;
          flex-direction: column;
          align-items: center;
          line-height: 1.02;
        }

        .nexus-wordmark-line {
          font-size: clamp(3.6rem, 6vw, 5.15rem);
          font-weight: 800;
          color: #ffffff;
          letter-spacing: -0.03em;
          text-shadow: 0 6px 28px rgba(2, 6, 23, 0.32);
        }

        .nexus-wordmark-dot {
          background: linear-gradient(135deg, #22d3ee, #818cf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        @media (max-width: 900px) {
          .nexus-auth-grid {
            grid-template-columns: 1fr;
            max-width: 440px;
            gap: 28px;
          }

          .nexus-brand-showcase {
            order: -1;
          }

          .nexus-logo-badge {
            margin-bottom: 10px;
          }

          .nexus-logo-badge img {
            width: 118px !important;
            height: 118px !important;
          }

          .nexus-wordmark-line {
            font-size: 2.85rem;
          }
        }

        @media (max-width: 480px) {
          .nexus-auth-card {
            padding: 24px 20px 18px;
            border-radius: 18px;
          }
        }
      `}</style>
    </div>
  );
};

export default Login;
