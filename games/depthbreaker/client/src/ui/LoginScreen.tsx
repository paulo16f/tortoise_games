// Pre-game account gate: email login / register, plus a guest fallback.
// On success it stores the session (session.ts) and hands control back to App,
// which advances to character select. Registering while a guest is active
// upgrades that guest account in place server-side, keeping its characters.

import { useState } from "react";
import { guestLogin, login as apiLogin, register as apiRegister } from "../net/backend";
import { getSession, setSession } from "../net/session";

const card: React.CSSProperties = {
  width: 360,
  background: "rgba(17,21,28,0.9)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 12,
  padding: 24,
  boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
};
const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "#0b0d12",
  color: "#e6e9ef",
  fontSize: 14,
  marginBottom: 10,
};

export function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const passwordValid = password.length >= 8 && password.length <= 128;
  const canSubmit = emailValid && passwordValid && !busy;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (mode === "login") {
        setSession(await apiLogin(email.trim(), password), "email");
      } else {
        // Upgrade the current guest in place if we have one; else a fresh account.
        setSession(await apiRegister(email.trim(), password, getSession()?.accessToken), "email");
      }
      onAuthed();
    });

  const asGuest = () =>
    run(async () => {
      setSession(await guestLogin(), "guest");
      onAuthed();
    });

  return (
    <div style={screen}>
      <div style={card}>
        <h1 style={{ margin: "0 0 4px", fontSize: 28, letterSpacing: 0.5 }}>Depthbreaker</h1>
        <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 20 }}>
          {mode === "login" ? "Log in to your account" : "Create an account"}
        </div>

        <input
          type="email"
          placeholder="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={field}
        />
        <input
          type="password"
          placeholder="password (min 8 chars)"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
          style={{ ...field, marginBottom: 6 }}
        />
        <div style={{ fontSize: 11, opacity: 0.55, minHeight: 14, marginBottom: 12 }}>
          {password.length > 0 && !passwordValid ? "Password must be 8–128 characters" : ""}
        </div>

        {error && <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <button onClick={submit} disabled={!canSubmit} style={primaryBtn(canSubmit)}>
          {busy ? "…" : mode === "login" ? "Log in" : "Register"}
        </button>

        <button
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          style={linkBtn}
        >
          {mode === "login" ? "Need an account? Register" : "Have an account? Log in"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
          <span style={{ opacity: 0.5, fontSize: 12 }}>or</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
        </div>

        <button onClick={asGuest} disabled={busy} style={ghostBtn}>
          Continue as guest
        </button>
      </div>
    </div>
  );
}

const screen: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "radial-gradient(circle at 50% 30%, #131722, #0b0d12)",
  color: "#e6e9ef",
  fontFamily: "system-ui, sans-serif",
};

function primaryBtn(enabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: 12,
    borderRadius: 8,
    border: "none",
    background: enabled ? "#3b82f6" : "#334155",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: enabled ? "pointer" : "default",
  };
}
const linkBtn: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: 6,
  background: "transparent",
  border: "none",
  color: "#93c5fd",
  fontSize: 13,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  width: "100%",
  padding: 11,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "#0b0d12",
  color: "#e6e9ef",
  fontSize: 14,
  cursor: "pointer",
};

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("invalid_credentials")) return "Wrong email or password.";
  if (msg.includes("email_taken")) return "That email is already registered.";
  if (msg.includes("not_upgradable")) return "This account can't be upgraded.";
  if (msg.includes("Failed to fetch")) return "Can't reach the server. Is the backend running?";
  return "Something went wrong. Try again.";
}
