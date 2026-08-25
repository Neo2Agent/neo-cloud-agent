import { IconSearch, IconSync } from "../icons";

export function PersonalChatHeader({
  title,
  onSearch,
  onRefresh,
}: {
  title: string;
  onSearch: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="personal-head">
      <h1>{title}</h1>
      <div className="chat-head-actions">
        <button type="button" className="icon-btn" aria-label="搜索" onClick={onSearch}>
          <IconSearch />
        </button>
        <button type="button" className="icon-btn" aria-label="刷新" onClick={onRefresh}>
          <IconSync />
        </button>
      </div>
    </header>
  );
}
