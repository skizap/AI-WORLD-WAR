import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI render boundary caught an error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app error-boundary" role="alert" aria-live="assertive">
        <p className="eyebrow">Research simulation interface</p>
        <h1>This view could not be rendered</h1>
        <p className="muted">The simulation data is unchanged. Reload the interface to recover.</p>
        <details>
          <summary>Technical error details</summary>
          <pre>{this.state.error.message}</pre>
        </details>
        <button type="button" onClick={() => window.location.reload()}>Reload interface</button>
      </main>
    );
  }
}
