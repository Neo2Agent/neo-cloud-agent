import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; onReset?: () => void };
type State = { error: Error | null };

export class ChatErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("chat render failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="empty" id="chat-crash">
        <h2>对话页刚才崩了</h2>
        <p>多半是流式更新太密。可以重试，不会丢掉已经落盘的对话。</p>
        <button
          type="button"
          className="ghost"
          id="chat-crash-retry"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}
        >
          重新加载对话
        </button>
      </div>
    );
  }
}
