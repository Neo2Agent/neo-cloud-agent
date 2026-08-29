import { Component, type ErrorInfo, type ReactNode } from "react";
import { IslandButton } from "./island";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Without this, one throw in a render or effect unmounts everything and the
 * Electron window just goes white with no clue why. Show the error and offer a
 * reload, since a stale preload after a hot reload is a common cause.
 */
export class ErrorScreen extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("desk ui crashed", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div className="crash">
        <h1>Desk 界面出错了</h1>
        <p>如果你刚更新过代码，退出 Desk 再重新打开：主进程和 preload 不会热更新。</p>
        <pre>{error.message}</pre>
        <div className="crash-actions">
          <IslandButton type="primary" onClick={() => window.location.reload()}>
            重新加载界面
          </IslandButton>
          <IslandButton type="default" onClick={() => this.setState({ error: null })}>
            再试一次
          </IslandButton>
        </div>
      </div>
    );
  }
}
