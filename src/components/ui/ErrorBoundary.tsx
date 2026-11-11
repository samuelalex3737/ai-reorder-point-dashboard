import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Keeps one failing view from blanking the whole dashboard. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="glass p-6 text-sm text-rose-200" role="alert">
          This view could not be drawn: {this.state.error.message}. Change a control or switch page to retry.
        </div>
      );
    }
    return this.props.children;
  }
}
