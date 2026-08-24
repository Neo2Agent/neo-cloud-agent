import type { Project } from "@neo-cloud-agent/contracts/project";

export function OverviewTab({
  project,
  onStartChat,
}: {
  project: Project;
  onStartChat: () => void;
}) {
  const recent = project.events.slice().reverse().slice(0, 5);
  return (
    <div className="workbench-stack">
      <section className="settings-card">
        <h2>项目指令</h2>
        <p className="hint">这个项目里开的对话都会自动带上。</p>
        <pre className="instruction-preview">{project.instruction.trim() || "（还没有写指令）"}</pre>
        <button type="button" className="dash-create" onClick={onStartChat}>
          在项目里开对话
        </button>
      </section>
      <section className="settings-card">
        <h2>成员</h2>
        <ul className="member-list">
          {project.members.map((item) => (
            <li key={item.userId}>
              <strong>{item.email}</strong>
              <span className={`role-badge ${item.role}`}>{roleLabel(item.role)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-card">
        <h2>最近动态</h2>
        {recent.length === 0 ? (
          <p className="hint">还没有动态。</p>
        ) : (
          <ul className="event-list">
            {recent.map((item) => (
              <li key={item.id}>
                <strong>{item.actorEmail}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function roleLabel(role: string): string {
  if (role === "owner") return "所有者";
  if (role === "admin") return "管理员";
  return "成员";
}
