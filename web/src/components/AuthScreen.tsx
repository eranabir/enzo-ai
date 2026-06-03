import { useEffect, useState } from "react";
import { api, setToken } from "../api";
import type { ProfileSummary, User } from "../types";
import { Label } from "./ui/Label";

const inputCls =
  "w-full rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-fg outline-none placeholder:text-muted focus:border-accent";

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 text-lg font-bold text-accent-2">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

export function AuthScreen({
  onAuthed,
  online,
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

  // login panel
  const [secret, setSecret] = useState("");
  const [usePin, setUsePin] = useState(false);

  // register form
  const [reg, setReg] = useState({
    username: "",
    password: "",
    firstName: "",
    lastName: "",
    nickname: "",
    superPowers: "",
    about: "",
    assistantStyle: "",
    pin: "",
  });

  useEffect(() => {
    api
      .profiles()
      .then((p) => {
        setProfiles(p);
        // Only fall back to the register form once we KNOW there are no
        // profiles — never during the initial async load.
        if (p.length === 0) setMode("register");
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function finish(token: string, user: User) {
    setToken(token);
    onAuthed(user);
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
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
        nickname: reg.nickname || undefined,
        superPowers: reg.superPowers || undefined,
        about: reg.about || undefined,
        assistantStyle: reg.assistantStyle || undefined,
        pin: reg.pin || undefined,
      });
      finish(token, user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-5xl text-accent-2">⬡</div>
          <h1 className="mt-2 text-2xl font-bold tracking-wide">enzo</h1>
          <p className="mt-1 text-sm text-muted">
            Your private, local AI — pick a profile or create one.
          </p>
          {online === false && (
            <p className="mt-2 text-xs text-danger">
              Local engine (Ollama) isn't running — you can still sign in.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          {/* Wait for the profile list before choosing picker vs register. */}
          {!loaded && (
            <div className="py-8 text-center text-sm text-muted">
              Loading profiles…
            </div>
          )}

          {/* ---------- Profile picker / login ---------- */}
          {loaded && mode === "picker" && !selected && (
            <>
              <div className="flex flex-col gap-2">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pick(p)}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-accent"
                  >
                    <Avatar name={p.displayName} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{p.displayName}</span>
                        {p.role === "admin" && (
                          <span className="flex-shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-2">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">
                        @{p.username}
                        {p.hasPin ? " · PIN" : ""}
                      </div>
                    </div>
                  </button>
                ))}
                {profiles.length === 0 && (
                  <div className="py-4 text-center text-sm text-muted">
                    No profiles yet.
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
                className="mt-4 w-full rounded-lg border border-dashed border-border py-2.5 text-sm text-muted transition-colors hover:border-accent hover:text-fg"
              >
                + Create new user
              </button>
            </>
          )}

          {/* ---------- Unlock selected profile ---------- */}
          {mode === "picker" && selected && (
            <form onSubmit={doLogin} className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Avatar name={selected.displayName} />
                <div>
                  <div className="font-semibold">{selected.displayName}</div>
                  <div className="text-xs text-muted">@{selected.username}</div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  {usePin ? "PIN" : "Password"}
                </label>
                <input
                  className={inputCls}
                  type="password"
                  inputMode={usePin ? "numeric" : "text"}
                  autoFocus
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={usePin ? "••••" : "Your password"}
                />
              </div>
              {selected.hasPin && (
                <button
                  type="button"
                  className="self-start text-xs text-accent-2 hover:underline"
                  onClick={() => {
                    setUsePin((v) => !v);
                    setSecret("");
                  }}
                >
                  {usePin ? "Use password instead" : "Use PIN instead"}
                </button>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted hover:text-fg"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy || !secret}
                  className="flex-1 rounded-lg bg-accent py-2.5 font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
                >
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </div>
            </form>
          )}

          {/* ---------- Register ---------- */}
          {mode === "register" && (
            <form onSubmit={doRegister} className="flex flex-col gap-4">

              {/* First-user admin notice */}
              {profiles.length === 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5">
                  <span className="mt-0.5 flex-shrink-0 text-sm text-accent-2">⬡</span>
                  <div>
                    <p className="text-xs font-semibold text-accent-2">You're the first user — you'll be the admin</p>
                    <p className="mt-0.5 text-[11px] text-muted leading-relaxed">
                      The first account created on this machine gets admin access: manage users, install models, and set system defaults.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Identity ── */}
              <div className="flex flex-col gap-3">
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-nickname">
                      Nickname <span className="font-normal text-muted/70">(optional)</span>
                    </Label>
                    <input id="reg-nickname" className={inputCls} placeholder="How Enzo calls you"
                      value={reg.nickname} onChange={(e) => setReg({ ...reg, nickname: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reg-username">Username</Label>
                    <input id="reg-username" className={inputCls} placeholder="jane"
                      value={reg.username} onChange={(e) => setReg({ ...reg, username: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* ── Security ── */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-pw">Password</Label>
                  <input id="reg-pw" className={inputCls} type="password" placeholder="At least 4 characters"
                    value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-pin">
                    Quick PIN <span className="font-normal text-muted/70">(optional)</span>
                  </Label>
                  <input id="reg-pin" className={inputCls} type="password" inputMode="numeric" placeholder="4–8 digits"
                    value={reg.pin} onChange={(e) => setReg({ ...reg, pin: e.target.value.replace(/\D/g, "") })} />
                </div>
              </div>

              {/* ── AI context ── */}
              <div className="flex flex-col gap-3 border-t border-border pt-3">
                <p className="text-xs font-semibold text-accent-2">Help Enzo get to know you</p>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-powers">
                    ⚡ Super powers
                    <span className="ml-1 font-normal text-muted/70">— your skills & expertise</span>
                  </Label>
                  <input id="reg-powers" className={inputCls}
                    placeholder="e.g. Full-stack dev, system design, coffee brewing, astrophysics"
                    value={reg.superPowers} onChange={(e) => setReg({ ...reg, superPowers: e.target.value })} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-about">About you</Label>
                  <textarea id="reg-about" className={`${inputCls} resize-none`} rows={2}
                    placeholder="e.g. Backend developer, loves hiking, learning Rust on weekends."
                    value={reg.about} onChange={(e) => setReg({ ...reg, about: e.target.value })} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-style">How should Enzo respond to you?</Label>
                  <textarea id="reg-style" className={`${inputCls} resize-none`} rows={2}
                    placeholder="e.g. Be concise, use code examples, skip the fluff."
                    value={reg.assistantStyle} onChange={(e) => setReg({ ...reg, assistantStyle: e.target.value })} />
                </div>
              </div>

              <div className="flex gap-2">
                {profiles.length > 0 && (
                  <button type="button" onClick={() => { setMode("picker"); setError(null); }}
                    className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted hover:text-fg">
                    Back
                  </button>
                )}
                <button type="submit" disabled={busy || !reg.username || !reg.password}
                  className="flex-1 rounded-lg bg-accent py-2.5 font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                  {busy ? "Creating…" : "Create account"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
