import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  key: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, key: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(error);
    this.props.onError?.(error);
  }

  private handleReload = () => {
    this.setState((prev) => ({ hasError: false, error: null, key: prev.key + 1 }));
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-6)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--font-size-sm)',
            height: '100%',
          }}
          role="alert"
        >
          <svg
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
          <h3
            style={{
              margin: 0,
              fontSize: 'var(--font-size-md)',
              color: 'var(--color-text-primary)',
            }}
          >
            Something went wrong
          </h3>
          <p style={{ margin: 0, maxWidth: 320 }}>
            {this.state.error?.message ?? 'An unexpected error occurred'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              marginTop: 'var(--space-2)',
              padding: 'var(--space-1) var(--space-3)',
              background: 'var(--color-interactive-default)',
              color: 'var(--color-text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return <div key={this.state.key}>{this.props.children}</div>;
  }
}
