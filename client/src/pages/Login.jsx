import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  ShieldAlert,
  LogIn,
  Eye,
  EyeOff,
  User,
  Lock,
  Settings,
  Brain,
  Phone,
  CreditCard
} from 'lucide-react';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(null);

  const { login } = useAuth();
  const navigate = useNavigate();

  const containerRef = useRef(null);
  const shineRef = useRef(null);



  // 3D Card Hover Perspective & Lighting Sheen
  const handleMouseMove = (e) => {
    const container = containerRef.current;
    const shine = shineRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const xc = rect.width / 2;
    const yc = rect.height / 2;

    const rotateX = -(y - yc) / 32;
    const rotateY = (x - xc) / 32;

    container.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;

    if (shine) {
      const shineX = (x / rect.width) * 100;
      const shineY = (y / rect.height) * 100;
      shine.style.background = `radial-gradient(circle at ${shineX}% ${shineY}%, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 70%)`;
    }
  };

  const handleMouseLeave = () => {
    const container = containerRef.current;
    const shine = shineRef.current;
    if (!container) return;

    container.style.transform = `perspective(1200px) rotateX(0deg) rotateY(0deg)`;
    if (shine) {
      shine.style.background = 'transparent';
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    if (!username || !password) {
      setError('Please enter both username and password.');
      setIsLoading(false);
      return;
    }
    const result = await login(username, password);
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error);
      setIsLoading(false);
    }
  };

  // Steps detailed configuration with clean relative label positioning
  const steps = [
    {
      id: 0,
      title: 'Lead Automation',
      description: 'Capture, enrich, and instantly capture high-performance sales leads.',
      icon: <Settings size={22} />,
      x: 200, y: 60,
      labelPos: 'pos-top',
      color: '#60a5fa' // bright blue
    },
    {
      id: 1,
      title: 'AI',
      description: 'Score opportunities, segment markets, and auto-route intelligently.',
      icon: <Brain size={22} />,
      x: 340, y: 200,
      labelPos: 'pos-right',
      color: '#818cf8' // vibrant indigo
    },
    {
      id: 2,
      title: 'Cloud telephony',
      description: 'Integrated dialer, real-time callbacks, and call recording sync.',
      icon: <Phone size={22} />,
      x: 200, y: 340,
      labelPos: 'pos-bottom',
      color: '#38bdf8' // bright sky
    },
    {
      id: 3,
      title: 'Payments',
      description: 'Track deals won, route commissions, and close revenue targets.',
      icon: <CreditCard size={22} />,
      x: 60, y: 200,
      labelPos: 'pos-left',
      color: '#34d399' // emerald green
    }
  ];

  return (
    <div className="login-page-wrapper">
      {/* Dynamic base layout container with 3D mouse tracking */}
      <div
        className="login-master-container"
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div className="card-shine" ref={shineRef} />

        {/* LEFT PANEL: Circular Workflow Orbit */}
        <div className="workflow-orbit-panel">
          <div className="orbit-diagram-container">

            {/* SVG Orbit Path */}
            <svg viewBox="0 0 400 400" className="orbit-svg-element">
              {/* Core Orbit Line */}
              <circle
                cx="200" cy="200" r="140"
                className="orbit-main-circle"
              />
            </svg>

            {/* Glowing Orbit Dot using CSS keyframes along SVG track */}
            <div className="orbit-traveler-glow" />

            {/* Center Brand Text Hub - aligned explicitly at 50%/50% */}
            <div className="orbit-center-hub">
              <span className="hub-text-brand">Nexus</span>
              <span className="hub-text-sub"></span>
              <div className="hub-ping-ring" />
            </div>

            {/* Interactive Workflow Orbit Nodes */}
            {steps.map((step) => {
              const isActive = activeStep === step.id;
              return (
                <div
                  key={step.id}
                  className={`orbit-node-item ${isActive ? 'active' : ''}`}
                  style={{
                    left: `${step.x}px`,
                    top: `${step.y}px`,
                    '--node-accent': step.color
                  }}
                  onMouseEnter={() => setActiveStep(step.id)}
                  onMouseLeave={() => setActiveStep(null)}
                >
                  <div className="node-icon-inner">
                    {step.icon}
                  </div>
                  {/* Node radar glow rings */}
                  <div className="node-radar" style={{ borderColor: step.color }} />

                  {/* Integrated aligned label - aligned perfectly next to circles */}
                  <div className={`orbit-node-label-child ${step.labelPos} ${isActive ? 'active' : ''}`}>
                    {step.title}
                  </div>
                </div>
              );
            })}

            {/* Dynamic Step description panel - fades in when steps are hovered */}
            <div className={`step-description-overlay ${activeStep !== null ? 'visible' : ''}`}>
              {activeStep !== null && (
                <>
                  <h4>{steps[activeStep].title}</h4>
                  <p>{steps[activeStep].description}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Form inputs & login controls */}
        <div className="login-form-panel">
          <div className="login-form-wrapper">

            {/* Header section matching ProLeads layout */}
            <h2 className="login-welcome-header">
              Welcome To <span className="brand-highlight">Nexus</span><span className="brand-accent"></span>
            </h2>
            <p className="login-welcome-tagline">Sign in to sync your high-performance workflow</p>

            {error && (
              <div className="error-alert-bar animate-scale-up">
                <ShieldAlert size={16} className="error-alert-icon" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="login-modern-form">
              {/* Username underline field */}
              <div className="underline-input-group">
                <input
                  id="login-username"
                  type="text"
                  className="underline-field"
                  placeholder="User Name"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={isLoading}
                  autoComplete="username"
                  required
                />
                <User size={18} className="field-side-icon" />
                <span className="field-glow-line" />
              </div>

              {/* Password underline field */}
              <div className="underline-input-group">
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  className="underline-field"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="current-password"
                  required
                  style={{ paddingRight: '40px' }}
                />
                <button
                  type="button"
                  className="password-reveal-button"
                  onClick={() => setShowPass(p => !p)}
                  aria-label="Toggle password visibility"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
                <span className="field-glow-line" />
              </div>

              {/* Login submit button */}
              <button
                id="login-submit"
                type="submit"
                className="btn btn-primary premium-purple-button"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="submit-spinner" />
                ) : (
                  <>
                    <span>Login</span>
                    <LogIn size={16} className="login-icon" />
                  </>
                )}
              </button>

              {/* Forgot password */}
              <a
                href="#forgot-password"
                className="forgot-password-link"
                onClick={(e) => { e.preventDefault(); alert("Please contact your CRM administrator to reset your password."); }}
              >
                Forgot Password
              </a>
            </form>
          </div>
        </div>
      </div>

      {/* Modern minimal clean footer */}
      <footer className="login-footer-bar">
        <span>© Copyrights 2026, Nexus - Syntopia Private Limited. All rights reserved.</span>
      </footer>

      <style>{`
        /* ── Base Wrapper Styling ── */
        .login-page-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
          position: relative;
          overflow: hidden;
          width: 100%;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background: #1d4ed8; /* Rich solid CRM primary blue */
        }

        /* ── 3D Master Glass Container ── */
        .login-master-container {
          display: flex;
          width: 100%;
          max-width: 960px;
          min-height: 520px;
          background: rgba(15, 23, 42, 0.42); /* Frosted slate dark-glass */
          backdrop-filter: blur(35px) saturate(180%);
          -webkit-backdrop-filter: blur(35px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 24px;
          box-shadow: 0 35px 85px -15px rgba(0, 0, 0, 0.5),
                      0 0 100px rgba(59, 130, 246, 0.1),
                      inset 0 1px 1px rgba(255, 255, 255, 0.15);
          position: relative;
          z-index: 2;
          overflow: hidden;
          transition: transform 0.15s ease-out;
          transform-style: preserve-3d;
        }

        .card-shine {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 10;
          mix-blend-mode: overlay;
          border-radius: 24px;
          transition: background 0.1s ease-out;
        }

        /* ── Left Circular Workflow Panel ── */
        .workflow-orbit-panel {
          flex: 1.1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.01);
          border-right: 1px solid rgba(255, 255, 255, 0.06);
          position: relative;
          padding: 40px;
          user-select: none;
          min-height: 480px;
        }

        .orbit-diagram-container {
          position: relative;
          width: 400px;
          height: 400px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .orbit-svg-element {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 1;
        }

        .orbit-main-circle {
          fill: none;
          stroke: rgba(255, 255, 255, 0.1);
          stroke-width: 1.5;
        }

        /* Pulsar traveler dot orbiting center */
        .orbit-traveler-glow {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #60a5fa;
          box-shadow: 0 0 16px 5px rgba(96, 165, 250, 0.6);
          z-index: 3;
          margin-left: -6px;
          margin-top: -6px;
          animation: orbit-rotation 16s linear infinite;
        }

        @keyframes orbit-rotation {
          from {
            transform: rotate(0deg) translateX(140px) rotate(0deg);
          }
          to {
            transform: rotate(360deg) translateX(140px) rotate(-360deg);
          }
        }

        /* Center Hub - aligned exactly at 50% 50% */
        .orbit-center-hub {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 5;
          text-align: center;
        }

        .hub-text-brand {
          font-size: 1.8rem;
          font-weight: 900;
          color: #ffffff;
          letter-spacing: -0.02em;
          line-height: 1;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .hub-text-sub {
          font-size: 1.05rem;
          font-weight: 750;
          color: #60a5fa;
          letter-spacing: 0.14em;
          margin-top: 2px;
          line-height: 1;
          text-shadow: 0 2px 8px rgba(96, 165, 250, 0.2);
        }

        .hub-ping-ring {
          position: absolute;
          inset: -20px;
          border: 1px solid rgba(96, 165, 250, 0.18);
          border-radius: 50%;
          animation: hub-pulse 3.5s cubic-bezier(0.25, 0, 0.35, 1) infinite;
        }

        @keyframes hub-pulse {
          0% { transform: scale(0.9); opacity: 0.9; }
          100% { transform: scale(1.4); opacity: 0; }
        }

        /* Orbit Nodes absolute wrapper */
        .orbit-node-item {
          position: absolute;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.16);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 4;
          transform: translate(-50%, -50%);
          cursor: pointer;
          transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
          color: #cbd5e1;
        }

        .orbit-node-item:hover, .orbit-node-item.active {
          color: #ffffff;
          background: var(--node-accent);
          border-color: var(--node-accent);
          transform: translate(-50%, -50%) scale(1.14);
          box-shadow: 0 8px 25px rgba(59, 130, 246, 0.4),
                      inset 0 1px 1px rgba(255, 255, 255, 0.4);
        }

        .node-icon-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.3s;
        }
        .orbit-node-item:hover .node-icon-inner {
          transform: rotate(15deg);
        }

        .node-radar {
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          border: 1.5px solid transparent;
          opacity: 0;
          transition: all 0.3s;
        }
        .orbit-node-item:hover .node-radar, .orbit-node-item.active .node-radar {
          opacity: 0.8;
          animation: node-radar-pulse 2s infinite;
        }

        @keyframes node-radar-pulse {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(1.25); opacity: 0; }
        }

        /* Node labels positioned relative as children of the absolute nodes */
        .orbit-node-label-child {
          position: absolute;
          font-size: 0.72rem;
          font-weight: 750;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
          pointer-events: none;
          transition: all 0.3s ease;
          opacity: 0.85;
          z-index: 3;
        }

        .orbit-node-label-child.active {
          color: #ffffff;
          font-weight: 850;
          opacity: 1;
          text-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
        }

        .orbit-node-label-child.pos-top {
          bottom: 100%;
          left: 50%;
          transform: translate(-50%, -12px);
        }

        .orbit-node-label-child.pos-right {
          left: 100%;
          top: 50%;
          transform: translate(14px, -50%);
        }

        .orbit-node-label-child.pos-bottom {
          top: 100%;
          left: 50%;
          transform: translate(-50%, 12px);
        }

        .orbit-node-label-child.pos-left {
          right: 100%;
          top: 50%;
          transform: translate(-14px, -50%);
        }

        /* Tooltip description panel */
        .step-description-overlay {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 82%;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 12px 16px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
          z-index: 6;
          opacity: 0;
          transition: opacity 0.35s ease, transform 0.35s ease;
          pointer-events: none;
          text-align: center;
        }

        .step-description-overlay.visible {
          opacity: 1;
          transform: translateX(-50%) translateY(-5px);
        }

        .step-description-overlay h4 {
          font-size: 0.84rem;
          font-weight: 800;
          color: #ffffff;
          margin-bottom: 2px;
        }

        .step-description-overlay p {
          font-size: 0.74rem;
          color: #94a3b8;
          line-height: 1.45;
          margin: 0;
        }

        /* ── Right Form Panel ── */
        .login-form-panel {
          flex: 0.9;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 48px;
          position: relative;
          z-index: 2;
        }

        .login-form-wrapper {
          width: 100%;
          max-width: 340px;
        }

        .login-welcome-header {
          font-size: 1.55rem;
          font-weight: 850;
          color: #ffffff;
          letter-spacing: -0.025em;
          margin-bottom: 6px;
          text-align: left;
        }
        
        .brand-highlight {
          color: #60a5fa;
        }
        .brand-accent {
          color: #818cf8;
          font-weight: 800;
        }

        .login-welcome-tagline {
          font-size: 0.84rem;
          color: #94a3b8;
          margin-bottom: 36px;
          text-align: left;
        }

        /* ── Underline Form Inputs ── */
        .login-modern-form {
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        .underline-input-group {
          position: relative;
          width: 100%;
          border-bottom: 1.5px solid rgba(255, 255, 255, 0.15);
          padding: 6px 0;
          display: flex;
          align-items: center;
          transition: border-color 0.3s ease;
        }

        .underline-field {
          width: 100%;
          border: none;
          background: transparent;
          font-size: 0.94rem;
          color: #ffffff;
          padding: 4px 28px 4px 0;
          font-family: inherit;
        }

        .underline-field::placeholder {
          color: #64748b;
        }

        .underline-field:focus {
          outline: none;
        }

        .field-side-icon {
          position: absolute;
          right: 0;
          color: #64748b;
          pointer-events: none;
          transition: color 0.3s;
        }

        .password-reveal-button {
          position: absolute;
          right: 0;
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.3s;
        }

        .underline-input-group:focus-within {
          border-color: #60a5fa;
        }

        .underline-input-group:focus-within .field-side-icon,
        .underline-input-group:focus-within .password-reveal-button {
          color: #60a5fa;
        }

        /* Expanding focus line */
        .field-glow-line {
          position: absolute;
          bottom: -1.5px;
          left: 0;
          width: 0;
          height: 1.8px;
          background: #60a5fa;
          transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .underline-input-group:focus-within .field-glow-line {
          width: 100%;
        }

        /* ── Premium Purple/Indigo Button ── */
        .premium-purple-button {
          width: 100%;
          height: 44px;
          background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
          color: #ffffff;
          border: none;
          border-radius: 6px;
          font-size: 0.88rem;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 14px;
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }

        .premium-purple-button:hover {
          background: linear-gradient(135deg, #1d4ed8 0%, #4338ca 100%);
          transform: translateY(-1.5px);
          box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
        }

        .premium-purple-button:active {
          transform: translateY(0);
          box-shadow: 0 4px 10px rgba(59, 130, 246, 0.2);
        }

        .premium-purple-button::after {
          content: '';
          position: absolute;
          top: 0;
          left: -70%;
          width: 45%;
          height: 100%;
          background: linear-gradient(
            to right, 
            rgba(255, 255, 255, 0) 0%, 
            rgba(255, 255, 255, 0.28) 50%, 
            rgba(255, 255, 255, 0) 100%
          );
          transform: skewX(-20deg);
          transition: 0.8s;
          pointer-events: none;
        }

        .premium-purple-button:hover::after {
          left: 120%;
          transition: all 0.75s ease-in-out;
        }

        .login-icon {
          transition: transform 0.2s;
        }
        .premium-purple-button:hover .login-icon {
          transform: translateX(3px);
        }

        .submit-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #ffffff;
          border-radius: 50%;
          display: inline-block;
          animation: spin-spin 0.75s linear infinite;
        }

        /* ── Forgot Password ── */
        .forgot-password-link {
          text-align: center;
          font-size: 0.82rem;
          color: #64748b;
          text-decoration: none;
          font-weight: 600;
          margin-top: 4px;
          transition: color 0.2s;
        }
        .forgot-password-link:hover {
          color: #60a5fa;
        }

        /* ── Error Toast ── */
        .error-alert-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(254, 242, 242, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fca5a5;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.82rem;
          font-weight: 600;
          margin-bottom: 22px;
          backdrop-filter: blur(4px);
        }

        .error-alert-icon {
          color: #ef4444;
          flex-shrink: 0;
        }

        /* ── Clean Minimal Footer ── */
        .login-footer-bar {
          margin-top: 24px;
          font-size: 0.7rem;
          color: #64748b;
          text-align: center;
          z-index: 2;
          font-weight: 550;
        }

        /* ── Animations ── */
        @keyframes spin-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: none; }
        }

        .animate-scale-up {
          animation: scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .animate-fade-up {
          animation: fadeUp 0.6s cubic-bezier(0.25, 1, 0.5, 1) forwards;
        }

        /* ── Ultra-Responsive Layouts ── */
        @media (max-width: 900px) {
          .login-page-wrapper {
            padding: 16px;
          }

          .login-master-container {
            flex-direction: column;
            max-width: 480px;
            min-height: auto;
            margin: 20px auto;
          }

          .workflow-orbit-panel {
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            padding: 20px;
            min-height: auto;
          }

          .orbit-diagram-container {
            transform: scale(0.8);
            margin: -25px 0;
          }

          .login-form-panel {
            padding: 32px 24px;
            width: 100%;
          }
        }

        @media (max-width: 520px) {
          .login-page-wrapper {
            padding: 8px;
          }

          .login-master-container {
            width: 100%;
            margin: 10px 0;
            border-radius: 18px;
          }

          .orbit-diagram-container {
            transform: scale(0.68);
            margin: -55px 0;
          }

          .login-welcome-header {
            font-size: 1.35rem;
          }

          .login-welcome-tagline {
            margin-bottom: 24px;
          }
        }
      `}</style>
    </div>
  );
};

export default Login;
