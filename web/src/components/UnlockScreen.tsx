import { useState } from "react";
import { Lock } from "lucide-react";
import { api } from "../api";

const inputCls =
  "w-full rounded-lg border border-border bg-surface-2/60 px-3.5 py-2.5 text-fg outline-none placeholder:text-muted focus:border-accent transition-colors text-sm";

/**
 * Full-screen gate shown when encryption is configured but the vault is locked.
 * The user enters their passphrase (or recovery key) to decrypt their data for
 * this session. Shown after sign-in, before the main app.
 */
export function UnlockScreen({ onUnlocked, onLogout }: { onUnlocked: () => void; onLogout: () => void }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api.vault.unlock(secret);
      onUnlocked();
    } catch (err) {
      setError((err as Error).message || "Incorrect passphrase or recovery key.");
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg p-4">
      <form onSubmit={unlock} className="w-full max-w-sm flex flex-col items-center gap-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface-2">
          <Lock className="h-6 w-6 text-accent-2" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold">Your chats are locked</h1>
          <p className="mt-1 text-sm text-muted">Enter your passphrase to unlock and decrypt your data.</p>
        </div>

        <div className="w-full flex flex-col gap-2">
          <input
            className={inputCls}
            type="password"
            autoFocus
            placeholder="Passphrase or recovery key"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy || !secret.trim()}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-40"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </div>

        <p className="text-center text-[11px] text-muted/70 leading-relaxed">
          Lost your passphrase? Enter your recovery key above instead.<br />
          Without either, encrypted chats can't be recovered.
        </p>
        <button type="button" onClick={onLogout} className="text-xs text-muted hover:text-fg">
          Sign out
        </button>
      </form>
    </div>
  );
}
