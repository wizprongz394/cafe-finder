"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

type Mode = "login" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        // Validate password length
        if (password.length < 8) {
          setError("Password must be at least 8 characters");
          setLoading(false);
          return;
        }

        // Signup API call
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });

        // Parse response once
        let signupData;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          signupData = await res.json();
        } else {
          const text = await res.text();
          signupData = { error: text || "Signup failed" };
        }

        if (!res.ok) {
          setError(signupData?.error || "Signup failed. Please try again.");
          setLoading(false);
          return;
        }

        // Auto-login after successful signup
        const signInRes = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (signInRes?.error) {
          setError("Account created but login failed. Please try signing in.");
          setLoading(false);
          setMode("login");
          return;
        }

        // Store auth flag and redirect
        router.push("/main");
      } else {
        // Login flow
        const res = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (res?.error) {
          setError("Invalid email or password");
          setLoading(false);
          return;
        }

        router.push("/main");
      }
    } catch (err) {
      console.error("Auth error:", err);
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signIn("google", { callbackUrl: "/main" });
    } catch (err) {
      console.error("Google sign in error:", err);
      setError("Google sign in failed. Please try again.");
      setLoading(false);
    }
  };

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setError(null);
    setFocusedField(null);
  };

  return (
    <>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=DM+Sans:wght@300;400;500&display=swap');

        *, *::before, *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          background: #FFECD1;
        }

        .auth-page {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr 1fr;
          font-family: 'DM Sans', sans-serif;
          background: #FFECD1;
        }

        /* Left Panel — Chocolate */
        .left-panel {
          background: #3E000C;
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 48px;
          overflow: hidden;
          animation: panelIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @keyframes panelIn {
          from { opacity: 0; transform: translateX(-24px); }
          to { opacity: 1; transform: translateX(0); }
        }

        .left-panel::before {
          content: '';
          position: absolute;
          width: 480px;
          height: 480px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,236,209,0.03) 0%, transparent 70%);
          top: -160px;
          right: -160px;
          pointer-events: none;
        }

        .left-panel::after {
          content: '';
          position: absolute;
          width: 300px;
          height: 300px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,236,209,0.02) 0%, transparent 70%);
          bottom: -80px;
          left: -80px;
          pointer-events: none;
        }

        .coffee-texture {
          position: absolute;
          inset: 0;
          opacity: 0.03;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 30 Q25 25 30 30 Q25 35 20 30Z' fill='%23FFECD1'/%3E%3Cpath d='M70 50 Q75 45 80 50 Q75 55 70 50Z' fill='%23FFECD1'/%3E%3Cpath d='M45 70 Q50 65 55 70 Q50 75 45 70Z' fill='%23FFECD1'/%3E%3C/svg%3E");
          background-repeat: repeat;
          background-size: 40px;
          pointer-events: none;
        }

        .brand {
          position: relative;
          z-index: 2;
        }

        .brand-name {
          font-family: 'Cormorant Garamond', serif;
          font-weight: 300;
          font-size: 42px;
          letter-spacing: 0.14em;
          color: #FFECD1;
          line-height: 1;
        }

        .brand-tagline {
          font-size: 11px;
          font-weight: 300;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: rgba(255,236,209,0.4);
          margin-top: 10px;
        }

        .hero-text {
          position: relative;
          z-index: 2;
        }

        .hero-text h2 {
          font-family: 'Cormorant Garamond', serif;
          font-weight: 300;
          font-style: italic;
          font-size: clamp(32px, 3vw, 48px);
          color: #FFECD1;
          line-height: 1.2;
          margin-bottom: 20px;
        }

        .hero-text p {
          font-size: 13px;
          font-weight: 300;
          color: rgba(255,236,209,0.5);
          line-height: 1.7;
          max-width: 280px;
        }

        .features {
          position: relative;
          z-index: 2;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .features li {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 12px;
          font-weight: 300;
          color: rgba(255,236,209,0.55);
          letter-spacing: 0.02em;
        }

        .feature-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #C08552;
          flex-shrink: 0;
        }

        .bracket {
          position: absolute;
          width: 36px;
          height: 36px;
          opacity: 0.15;
        }

        .bracket-tr {
          top: 32px;
          right: 32px;
          border-top: 1px solid #FFECD1;
          border-right: 1px solid #FFECD1;
        }

        .bracket-bl {
          bottom: 32px;
          left: 32px;
          border-bottom: 1px solid #FFECD1;
          border-left: 1px solid #FFECD1;
        }

        /* Right Panel — Sand/Cream */
        .right-panel {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 64px 48px;
          background: #FFECD1;
          animation: formIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
        }

        @keyframes formIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .form-container {
          width: 100%;
          max-width: 380px;
        }

        .mode-tabs {
          display: flex;
          gap: 0;
          margin-bottom: 40px;
          border-bottom: 1px solid rgba(62,0,12,0.12);
        }

        .tab-btn {
          flex: 1;
          padding: 12px 0;
          background: none;
          border: none;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 400;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(62,0,12,0.35);
          position: relative;
          transition: color 0.3s ease;
        }

        .tab-btn.active {
          color: #3E000C;
        }

        .tab-btn.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 1.5px;
          background: #C08552;
          animation: tabLine 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @keyframes tabLine {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }

        .form-heading {
          margin-bottom: 32px;
        }

        .form-heading h1 {
          font-family: 'Cormorant Garamond', serif;
          font-weight: 300;
          font-size: 36px;
          color: #3E000C;
          line-height: 1.1;
          margin-bottom: 8px;
        }

        .form-heading p {
          font-size: 12px;
          font-weight: 300;
          color: #895737;
          letter-spacing: 0.01em;
        }

        .error-message {
          background: rgba(158, 58, 58, 0.08);
          border: 1px solid rgba(158, 58, 58, 0.2);
          border-radius: 8px;
          padding: 12px 14px;
          margin-bottom: 20px;
          font-size: 12px;
          font-weight: 300;
          color: #9e3a3a;
          display: flex;
          align-items: center;
          gap: 8px;
          animation: slideIn 0.25s ease-out;
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .error-message button {
          margin-left: auto;
          background: none;
          border: none;
          font-size: 14px;
          color: rgba(158, 58, 58, 0.5);
          cursor: pointer;
          transition: color 0.15s;
          padding: 0;
          line-height: 1;
        }

        .error-message button:hover {
          color: #9e3a3a;
        }

        .form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 7px;
          animation: fieldIn 0.5s ease both;
        }

        .field:nth-child(1) { animation-delay: 0.05s; }
        .field:nth-child(2) { animation-delay: 0.1s; }
        .field:nth-child(3) { animation-delay: 0.15s; }

        @keyframes fieldIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        label {
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: #895737;
          transition: color 0.25s;
        }

        label.focused {
          color: #3E000C;
        }

        input {
          width: 100%;
          padding: 13px 16px;
          background: #F3E9DC;
          border: 1px solid rgba(62,0,12,0.15);
          border-radius: 8px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 300;
          color: #3E000C;
          outline: none;
          transition: all 0.25s ease;
        }

        input::placeholder {
          color: rgba(62,0,12,0.25);
        }

        input:focus {
          border-color: #C08552;
          background: #FFECD1;
          box-shadow: 0 0 0 2px rgba(192,133,82,0.1);
        }

        input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .submit-btn {
          margin-top: 8px;
          width: 100%;
          padding: 15px;
          background: #5E3023;
          border: none;
          border-radius: 8px;
          color: #FFECD1;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 400;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: all 0.25s ease;
        }

        .submit-btn:hover:not(:disabled) {
          background: #3E000C;
          transform: translateY(-1px);
        }

        .submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .submit-btn.loading::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent 0%, rgba(255,236,209,0.15) 50%, transparent 100%);
          transform: translateX(-100%);
          animation: shimmer 1.2s ease infinite;
        }

        @keyframes shimmer {
          to { transform: translateX(100%); }
        }

        .auth-divider {
          display: flex;
          align-items: center;
          gap: 16px;
          margin: 24px 0;
        }

        .auth-divider::before,
        .auth-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(62,0,12,0.1);
        }

        .auth-divider span {
          font-size: 10px;
          font-weight: 300;
          letter-spacing: 0.12em;
          color: #895737;
          text-transform: uppercase;
        }

        .social-btn {
          width: 100%;
          padding: 13px;
          background: #F3E9DC;
          border: 1px solid rgba(62,0,12,0.15);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 400;
          letter-spacing: 0.06em;
          color: #5E3023;
          cursor: pointer;
          transition: all 0.25s ease;
        }

        .social-btn:hover:not(:disabled) {
          border-color: #C08552;
          background: #FFECD1;
          transform: translateY(-1px);
        }

        .social-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .switch-mode {
          margin-top: 28px;
          text-align: center;
          font-size: 12px;
          font-weight: 300;
          color: #895737;
        }

        .switch-mode button {
          background: none;
          border: none;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 400;
          color: #C08552;
          text-decoration: none;
          padding: 0;
          transition: color 0.25s;
        }

        .switch-mode button:hover:not(:disabled) {
          color: #3E000C;
          text-decoration: underline;
        }

        .switch-mode button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .bottom-note {
          position: absolute;
          bottom: 32px;
          font-size: 10px;
          font-weight: 300;
          letter-spacing: 0.16em;
          color: rgba(62,0,12,0.25);
          text-transform: uppercase;
        }

        @media (max-width: 768px) {
          .auth-page {
            grid-template-columns: 1fr;
          }
          .left-panel {
            display: none;
          }
          .right-panel {
            padding: 48px 28px;
            justify-content: flex-start;
            padding-top: 64px;
          }
        }
      `}</style>

      <div className="auth-page">
        <div className="left-panel">
          <div className="coffee-texture" />
          <div className="bracket bracket-tr" />
          <div className="bracket bracket-bl" />

          <div className="brand">
            <div className="brand-name">EXPRESSO</div>
            <div className="brand-tagline">Your city, your table</div>
          </div>

          <div className="hero-text">
            <h2>
              Find where
              <br />
              everyone agrees.
            </h2>
            <p>
              Group dining, solo cravings, or somewhere new — Expresso finds the
              right spot for the moment.
            </p>
          </div>

          <ul className="features">
            <li>
              <span className="feature-dot" />
              Smart group recommendations
            </li>
            <li>
              <span className="feature-dot" />
              Split plans when tastes differ
            </li>
            <li>
              <span className="feature-dot" />
              Real prices, real distance
            </li>
            <li>
              <span className="feature-dot" />
              Works anywhere in India
            </li>
          </ul>
        </div>

        <div className="right-panel">
          <div className="form-container">
            <div className="mode-tabs">
              <button
                type="button"
                className={`tab-btn ${mode === "login" ? "active" : ""}`}
                onClick={() => switchMode("login")}
                disabled={loading}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`tab-btn ${mode === "signup" ? "active" : ""}`}
                onClick={() => switchMode("signup")}
                disabled={loading}
              >
                Create account
              </button>
            </div>

            <div className="form-heading">
              <h1>
                {mode === "login" ? "Welcome back." : "Join Expresso."}
              </h1>
              <p>
                {mode === "login"
                  ? "Sign in to access your saved places and groups."
                  : "Create your account and start discovering together."}
              </p>
            </div>

            {error && (
              <div className="error-message">
                <span>⚠</span>
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)}>
                  ✕
                </button>
              </div>
            )}

            <form className="form" onSubmit={handleSubmit}>
              {mode === "signup" && (
                <div className="field">
                  <label className={focusedField === "name" ? "focused" : ""}>
                    Full name
                  </label>
                  <input
                    type="text"
                    placeholder="Prongz"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={() => setFocusedField("name")}
                    onBlur={() => setFocusedField(null)}
                    required
                    disabled={loading}
                    autoComplete="name"
                  />
                </div>
              )}

              <div className="field">
                <label className={focusedField === "email" ? "focused" : ""}>
                  Email address
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedField("email")}
                  onBlur={() => setFocusedField(null)}
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>

              <div className="field">
                <label className={focusedField === "password" ? "focused" : ""}>
                  Password
                </label>
                <input
                  type="password"
                  placeholder={
                    mode === "signup" ? "Min. 8 characters" : "Your password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  required
                  disabled={loading}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  minLength={mode === "signup" ? 8 : undefined}
                />
              </div>

              {mode === "login" && (
                <div style={{ textAlign: "right", marginTop: "-8px" }}>
                  <button
                    type="button"
                    disabled={loading}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: loading ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      fontWeight: "300",
                      color: "#895737",
                      fontFamily: "'DM Sans', sans-serif",
                      letterSpacing: "0.04em",
                      opacity: loading ? 0.5 : 1,
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <button
                type="submit"
                className={`submit-btn ${loading ? "loading" : ""}`}
                disabled={loading}
              >
                {loading
                  ? "Please wait…"
                  : mode === "login"
                  ? "Sign in"
                  : "Create account"}
              </button>
            </form>

            <div className="auth-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="social-btn"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>

            <p className="switch-mode">
              {mode === "login" ? (
                <>
                  New to Expresso?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    disabled={loading}
                  >
                    Create account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    disabled={loading}
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
          <span className="bottom-note">Expresso © 2025</span>
        </div>
      </div>
    </>
  );
}