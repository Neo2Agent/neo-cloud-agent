import type { ReactNode } from "react";

export function PersonalChatHeader({ title, meta, end }: { title: string; meta?: ReactNode; end?: ReactNode }) {
  return (
    <header className="personal-head">
      <h1>{title}</h1>
      {meta}
      {end}
    </header>
  );
}
