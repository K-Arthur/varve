import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
  /** If true, shows expandable error details with copy-to-clipboard. */
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  key: number;
  detailsOpen: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private reloadButtonRef = createRef<HTMLButtonElement>();

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, key: 0, detailsOpen: false, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(error);
    this.props.onError?.(error);
    requestAnimationFrame(() => {
      this.reloadButtonRef.current?.focus();
    });
  }

  private handleReload = () => {
    this.setState((prev) => ({ hasError: false, error: null, key: prev.key + 1 }));
  };

  private handleCopyError = () => {
    if (!this.state.error) return;
    const text = `${this.state.error.message}\n${this.state.error.stack ?? ''}`;
    navigator.clipboard.writeText(text).then(
      () => {
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2000);
      },
      () => {
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2000);
      },
    );
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      const { error, detailsOpen, copied } = this.state;
      return (
        <div className="error-boundary" role="alert">
          <svg
            className="error-boundary__icon"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <title>Error</title>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h3 className="error-boundary__title">Something went wrong</h3>
          <p className="error-boundary__message">
            {error?.message ?? 'An unexpected error occurred'}
          </p>
          <div className="error-boundary__actions">
            <button
              ref={this.reloadButtonRef}
              type="button"
              onClick={this.handleReload}
              className="error-boundary__action"
            >
              Reload
            </button>
            {this.props.showDetails && error && (
              <button
                type="button"
                onClick={this.handleCopyError}
                className="error-boundary__action error-boundary__action--secondary"
              >
                {copied ? 'Error copied' : 'Copy error'}
              </button>
            )}
          </div>
          {this.props.showDetails && error && (
            <details
              className="error-boundary__details"
              open={detailsOpen}
              onToggle={(e) =>
                this.setState({ detailsOpen: (e.target as HTMLDetailsElement).open })
              }
            >
              <summary className="error-boundary__summary">Error details</summary>
              <pre className="error-boundary__stack">{error.stack ?? error.message}</pre>
            </details>
          )}
        </div>
      );
    }

    // display:contents makes this wrapper invisible to layout — without it,
    // this div sits between whatever CSS Grid/Flex container renders
    // <ErrorBoundary> and its child, breaking the child's grid-area/flex-item
    // placement (e.g. CanvasArea's `.editor-canvas` relies on being a direct
    // grid item of `.editor-shell` for `grid-area: canvas` + stretch sizing;
    // an unstyled wrapper collapses it to 0 height since all of its own
    // children are absolutely positioned).
    return (
      <div key={this.state.key} style={{ display: 'contents' }}>
        {this.props.children}
      </div>
    );
  }
}
