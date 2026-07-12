// Pre-game account gate: email login / register, plus a guest fallback.
// On success it stores the session (session.ts) and hands control back to App,
// which advances to character select. Registering while a guest is active
// upgrades that guest account in place server-side, keeping its characters.
// Styled as an atmospheric fantasy title screen (see menu/menuTheme).

import { useState } from "react";
import { guestLogin, login as apiLogin, register as apiRegister } from "../net/backend";
import { getSession, setSession } from "../net/session";
import { MenuBackdrop } from "./menu/MenuBackdrop";
import { MENU, framePanel, goldButton, ghostButton, menuField, menuScreen, linkButton, goldRule } from "./menu/menuTheme";

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
    <div style={menuScreen}>
      <MenuBackdrop />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", width: 380 }}>
        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <h1 style={title}>DEPTHBREAKER</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <div style={{ ...goldRule, flex: 1 }} />
            <span style={{ color: MENU.gold, fontSize: 18, lineHeight: 1 }}>◆</span>
            <div style={{ ...goldRule, flex: 1 }} />
          </div>
          <div style={{ color: MENU.parchmentDim, fontSize: 12.5, letterSpacing: 2.5, marginTop: 8, textTransform: "uppercase" }}>
            Descend · Plunder · Endure
          </div>
        </div>

        {/* Auth card */}
        <div style={{ ...framePanel, width: "100%", padding: 22, boxSizing: "border-box" }}>
          <div style={{ color: MENU.parchmentDim, fontSize: 13, marginBottom: 16, textAlign: "center" }}>
            {mode === "login" ? "Enter your credentials" : "Forge a new account"}
          </div>

          <input
            type="email"
            placeholder="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ ...menuField, marginBottom: 10 }}
          />
          <input
            type="password"
            placeholder="password (min 8 chars)"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
            style={menuField}
          />
          <div style={{ fontSize: 11, color: MENU.parchmentDim, minHeight: 14, margin: "6px 0 10px" }}>
            {password.length > 0 && !passwordValid ? "Password must be 8–128 characters" : ""}
          </div>

          {error && <div style={{ color: MENU.danger, fontSize: 12.5, marginBottom: 12, textAlign: "center" }}>{error}</div>}

          <button onClick={submit} disabled={!canSubmit} style={{ ...goldButton(canSubmit), width: "100%" }}>
            {busy ? "…" : mode === "login" ? "Log In" : "Register"}
          </button>

          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            style={{ ...linkButton, width: "100%", marginTop: 12, padding: 4 }}
          >
            {mode === "login" ? "Need an account? Register" : "Have an account? Log in"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
            <div style={{ ...goldRule, flex: 1 }} />
            <span style={{ color: MENU.parchmentDim, fontSize: 11 }}>or</span>
            <div style={{ ...goldRule, flex: 1 }} />
          </div>

          <button onClick={asGuest} disabled={busy} style={{ ...ghostButton(!busy), width: "100%" }}>
            Continue as guest
          </button>
        </div>
      </div>
    </div>
  );
}

const title: React.CSSProperties = {
  margin: 0,
  fontFamily: MENU.display,
  fontSize: 46,
  fontWeight: 700,
  letterSpacing: 6,
  color: MENU.parchment,
  textShadow: `0 2px 0 #000, 0 0 26px rgba(201,165,74,0.35)`,
  background: `linear-gradient(180deg, ${MENU.goldBright}, ${MENU.gold} 55%, ${MENU.goldDim})`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("invalid_credentials")) return "Wrong email or password.";
  if (msg.includes("email_taken")) return "That email is already registered.";
  if (msg.includes("not_upgradable")) return "This account can't be upgraded.";
  if (msg.includes("Failed to fetch")) return "Can't reach the server. Is the backend running?";
  return "Something went wrong. Try again.";
}
