import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg p-8">
          <div className="max-w-lg rounded-2xl border border-danger/40 bg-danger/10 p-6">
            <h1 className="mb-2 text-lg font-bold text-danger">Enzo AI — startup error</h1>
            <p className="mb-4 text-sm text-muted">
              Something went wrong loading the app. Please restart Enzo AI from the tray.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-fg">
              {this.state.error.message}
              {"\n"}
              {this.state.error.stack?.slice(0, 400)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
