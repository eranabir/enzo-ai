import { useEffect, useState } from "react";
import { api, setToken } from "../api";
import type { ProfileSummary, User } from "../types";
import { Label } from "./ui/Label";
import { SetupWizard } from "./SetupWizard";

const inputCls =
  "w-full rounded-lg border border-border bg-surface-2/60 px-3.5 py-2.5 text-fg backdrop-blur-sm outline-none placeholder:text-muted focus:border-accent transition-colors text-sm";

// ── Status grid ───────────────────────────────────────────────────────────────

interface ServerStatus { ollama: boolean; models: number; users: number }

function StatusGrid({ status }: { status: ServerStatus | null }) {
  const items = [
    {
      label: "ENGINE",
      value: status === null ? "…" : status.ollama ? "Online" : "Offline",
      ok: status?.ollama ?? null,
      icon: "⬡",
    },
    {
      label: "MODELS",
      value: status === null ? "…" : `${status.models} ready`,
      ok: status !== null ? status.models > 0 : null,
      icon: "◈",
    },
    {
      label: "USERS",
      value: status === null ? "…" : `${status.users} profile${status.users !== 1 ? "s" : ""}`,
      ok: status !== null ? true : null,
      icon: "◎",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 w-full max-w-sm mx-auto mb-8">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-border/50 bg-surface/40 backdrop-blur-sm px-3 py-2.5 text-center"
        >
          <div className="text-[10px] font-bold tracking-widest text-muted mb-1">
            {item.label}
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <span
              className={`text-[10px] font-black ${
                item.ok === null ? "text-muted animate-pulse" :
                item.ok ? "text-ok" : "text-danger"
              }`}
            >
              ●
            </span>
            <span className="text-xs font-semibold text-fg">{item.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main AuthScreen ───────────────────────────────────────────────────────────

export function AuthScreen({
  onAuthed,
}: {
  onAuthed: (user: User) => void;
  online: boolean | null;
}) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"picker" | "register">("picker");
  const [selected, setSelected] = useState<ProfileSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [usePin, setUsePin] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [newUser, setNewUser] = useState<User | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const [reg, setReg] = useState({
    username: "", password: "",
    firstName: "", lastName: "",
    superPowers: "", about: "", assistantStyle: "", pin: "",
  });

  // Poll server status for the status grid
  useEffect(() => {
    const poll = async () => {
      try {
        const [ollamaRes, profilesRes] = await Promise.all([
          api.status(),
          api.profiles(),
        ]);
        // Models count from /api/models is protected; estimate from Ollama being up
        setStatus({ ollama: ollamaRes.ollama, models: ollamaRes.ollama ? 1 : 0, users: profilesRes.length });
        setProfiles(profilesRes);
        if (!loaded) {
          if (profilesRes.length === 0) setMode("register");
          setLoaded(true);
        }
      } catch {
        setStatus({ ollama: false, models: 0, users: 0 });
        if (!loaded) setLoaded(true);
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [loaded]);

  function finish(token: string, user: User) {
    setToken(token);
    if (profiles.length === 0 && !localStorage.getItem("enzo_wizard_done")) {
      setNewUser(user);
      setShowWizard(true);
    } else {
      onAuthed(user);
    }
  }

  function pick(p: ProfileSummary) {
    setSelected(p);
    setSecret("");
    setUsePin(p.hasPin);
    setError(null);
  }

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.login({
        username: selected.username,
        password: usePin ? undefined : secret,
        pin: usePin ? secret : undefined,
      });
      finish(token, user);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function doRegister(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.register({
        username: reg.username,
        password: reg.password,
        firstName: reg.firstName || undefined,
        lastName: reg.lastName || undefined,
        superPowers: reg.superPowers || undefined,
        about: reg.about || undefined,
        assistantStyle: reg.assistantStyle || undefined,
        pin: reg.pin || undefined,
      });
      finish(token, user);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  if (showWizard && newUser) {
    return <SetupWizard user={newUser} onDone={() => { setShowWizard(false); onAuthed(newUser); }} />;
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-6 py-12">
      {/* Background grid */}
      <div className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "linear-gradient(rgba(109,94,252,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(109,94,252,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Radial glow */}
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 70% 40% at 50% 20%, rgba(109,94,252,0.07) 0%, transparent 70%)" }}
      />

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-2xl"
            style={{ boxShadow: "0 0 24px rgba(109,94,252,0.2)" }}>
            ⬡
          </div>
          <h1 className="text-2xl font-bold tracking-tight">enzo ai</h1>
          <p className="mt-1 text-sm text-muted">Your private, local AI — running on this machine</p>
        </div>

        {/* Status grid */}
        <StatusGrid status={loaded ? status : null} />

        {/* Main card */}
        <div className="rounded-2xl border border-border/60 bg-surface/70 backdrop-blur-md p-6"
          style={{ boxShadow: "0 0 0 1px rgba(109,94,252,0.08), 0 24px 48px rgba(0,0,0,0.4)" }}>

          {error && (
            <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
          )}

          {/* ── Profile picker ── */}
          {mode === "picker" && !selected && loaded && (
            <>
              {profiles.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-muted mb-1">No profiles yet</p>
                  <p className="text-xs text-muted/60">Create your account to get started</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 mb-4">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => pick(p)}
                      className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface-2/60 px-3.5 py-3 text-left backdrop-blur-sm transition-all hover:border-accent/40 hover:bg-surface-2"
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-base font-bold text-accent-2">
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-fg">{p.username}</span>
                          {p.role === "admin" && (
                            <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-2">Admin</span>
                          )}
                        </div>
                        <div className="text-xs text-muted">{p.hasPin ? "Password · PIN" : "Password"}</div>
                      </div>
                      <span className="text-muted text-sm">→</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => { setMode("register"); setError(null); }}
                className="w-full rounded-xl border border-dashed border-border py-2.5 text-sm text-muted transition-colors hover:border-accent hover:text-fg"
              >
                + Create new user
              </button>
            </>
          )}

          {/* ── Login ── */}
          {mode === "picker" && selected && (
            <form onSubmit={doLogin} className="flex flex-col gap-4">
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 text-base font-bold text-accent-2">
                  {selected.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold">{selected.username}</div>
                  <div className="text-xs text-muted">{usePin ? "Enter your PIN" : "Enter your password"}</div>
                </div>
              </div>
              <input
                className={inputCls}
                type="password"
                inputMode={usePin ? "numeric" : "text"}
                autoFocus
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={usePin ? "••••" : "Your password"}
              />
              {selected.hasPin && (
                <button type="button" className="self-start text-xs text-accent-2 hover:underline"
                  onClick={() => { setUsePin((v) => !v); setSecret(""); }}>
                  {usePin ? "Use password instead" : "Use PIN instead"}
                </button>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted hover:text-fg">Back</button>
                <button type="submit" disabled={busy || !secret} className="flex-1 rounded-xl bg-accent py-2.5 font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </div>
            </form>
          )}

          {/* ── Loading ── */}
          {mode === "picker" && !loaded && (
            <div className="py-8 text-center text-sm text-muted animate-pulse">Loading profiles…</div>
          )}

          {/* ── Register ── */}
          {mode === "register" && (
            <form onSubmit={doRegister} className="flex flex-col gap-4">
              {profiles.length === 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5">
                  <span className="mt-0.5 flex-shrink-0 text-sm text-accent-2">⬡</span>
                  <div>
                    <p className="text-xs font-semibold text-accent-2">You're the first user — you'll be the admin</p>
                    <p className="mt-0.5 text-[11px] text-muted leading-relaxed">
                      The first account gets admin access to manage users, models, and system settings.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-first">First name</Label>
                  <input id="reg-first" className={inputCls} placeholder="Jane" autoFocus
                    value={reg.firstName} onChange={(e) => setReg({ ...reg, firstName: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-last">Last name</Label>
                  <input id="reg-last" className={inputCls} placeholder="Smith"
                    value={reg.lastName} onChange={(e) => setReg({ ...reg, lastName: e.target.value })} />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reg-user">Username <span className="font-normal text-muted/70">— used to sign in</span></Label>
                <input id="reg-user" className={inputCls} placeholder="jane"
                  value={reg.username} onChange={(e) => setReg({ ...reg, username: e.target.value })} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-pw">Password</Label>
                  <input id="reg-pw" className={inputCls} type="password" placeholder="Min 4 chars"
                    value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-pin">PIN <span className="font-normal text-muted/70">(optional)</span></Label>
                  <input id="reg-pin" className={inputCls} type="password" inputMode="numeric" placeholder="4–8 digits"
                    value={reg.pin} onChange={(e) => setReg({ ...reg, pin: e.target.value.replace(/\D/g, "") })} />
                </div>
              </div>

              <div className="border-t border-border pt-3 flex flex-col gap-3">
                <p className="text-xs font-semibold text-accent-2">⚡ Help Enzo AI get to know you</p>
                <input className={inputCls} placeholder="Super powers — your skills & expertise"
                  value={reg.superPowers} onChange={(e) => setReg({ ...reg, superPowers: e.target.value })} />
                <textarea className={`${inputCls} resize-none`} rows={2}
                  placeholder="About you — interests, background, context for Enzo AI…"
                  value={reg.about} onChange={(e) => setReg({ ...reg, about: e.target.value })} />
              </div>

              <div className="flex gap-2">
                {profiles.length > 0 && (
                  <button type="button" onClick={() => { setMode("picker"); setError(null); }}
                    className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted hover:text-fg">Back</button>
                )}
                <button type="submit" disabled={busy || !reg.username || !reg.password}
                  className="flex-1 rounded-xl bg-accent py-2.5 font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                  {busy ? "Creating…" : "Create account"}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-muted/50">
          All data stays on this machine · zero telemetry
        </p>
      </div>
    </div>
  );
}
