import { Component, type ErrorInfo, type ReactNode } from "react";

import { ErrorState } from "../components/ui/page";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught render error", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="mx-auto max-w-2xl px-5 py-20">
          <ErrorState error={this.state.error} onRetry={() => window.location.reload()} />
        </main>
      );
    }

    return this.props.children;
  }
}
