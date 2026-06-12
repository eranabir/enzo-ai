import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./Dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

/** Styled, app-native replacement for window.confirm(). Returns a Promise<boolean>. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => setReq({ opts, resolve }));
  }, []);

  const finish = (value: boolean) => {
    req?.resolve(value);
    setReq(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!req} onOpenChange={(open) => { if (!open) finish(false); }}>
        {req && (
          <DialogContent className="z-[60] max-w-sm">
            <DialogHeader>
              <DialogTitle>{req.opts.title}</DialogTitle>
              {req.opts.description && <DialogDescription>{req.opts.description}</DialogDescription>}
            </DialogHeader>
            <div className="flex justify-end gap-2 px-6 pb-6 pt-2">
              <button
                onClick={() => finish(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-fg"
              >
                {req.opts.cancelText ?? "Cancel"}
              </button>
              <button
                autoFocus
                onClick={() => finish(true)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
                  req.opts.danger ? "bg-danger hover:bg-danger/90" : "bg-accent hover:bg-accent-2"
                }`}
              >
                {req.opts.confirmText ?? "Confirm"}
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}
