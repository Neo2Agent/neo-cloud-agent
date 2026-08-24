import type { Project } from "@neo-cloud-agent/contracts/project";
import { MessagesTab } from "./MessagesTab";

export function ActivityTab({
  project,
  token,
  userId,
}: {
  project: Project;
  token: string;
  userId: string;
}) {
  const events = project.events.slice().reverse();
  return (
    <div className="workbench-stack">
      <MessagesTab token={token} project={project} userId={userId} />
      <section className="settings-card">
        <h2>系统动态</h2>
        {events.length === 0 ? (
          <p className="hint">改指令、邀请成员、转交对话会出现在这里。</p>
        ) : (
          <ul className="event-list">
            {events.map((item) => (
              <li key={item.id}>
                <strong>{item.actorEmail}</strong>
                <span>{item.detail}</span>
                <em>{item.at.slice(0, 16).replace("T", " ")}</em>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
