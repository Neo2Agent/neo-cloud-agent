import type { Project } from "@neo-cloud-agent/contracts/project";
import { formatRel, initials } from "./helpers";
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
    <div className="activity-split">
      <MessagesTab token={token} project={project} userId={userId} />
      <section className="activity-feed">
        <h2>系统动态</h2>
        {events.length === 0 ? (
          <p className="hint">改指令、邀请成员、转交对话会出现在这里。</p>
        ) : (
          <ul className="timeline">
            {events.map((item) => (
              <li key={item.id}>
                <span className="avatar">{initials(item.actorEmail)}</span>
                <div>
                  <strong>{item.actorEmail}</strong>
                  <p>{item.detail}</p>
                </div>
                <em>{formatRel(item.at)}</em>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
