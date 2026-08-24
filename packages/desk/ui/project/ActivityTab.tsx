import type { Project } from "@neo-cloud-agent/contracts/project";

export function ActivityTab({ project }: { project: Project }) {
  const events = project.events.slice().reverse();
  if (events.length === 0) {
    return (
      <div className="workbench-empty">
        <strong>还没有动态</strong>
        <p>改指令、邀请成员、转交对话会出现在这里。</p>
      </div>
    );
  }
  return (
    <ul className="event-list">
      {events.map((item) => (
        <li key={item.id}>
          <strong>{item.actorEmail}</strong>
          <span>{item.detail}</span>
          <em>{item.at.slice(0, 16).replace("T", " ")}</em>
        </li>
      ))}
    </ul>
  );
}
