import { canManageProject, type Project } from "@neo-cloud-agent/contracts/project";
import { IconPlus } from "../icons";
import { displayName, initials, repoShort, roleLabel } from "./helpers";

export function ProjectConfigRail({
  project,
  userId,
  onEdit,
}: {
  project: Project;
  userId: string;
  onEdit: () => void;
}) {
  const manage = canManageProject(project.members.find((item) => item.userId === userId)?.role);
  const pending = project.invites.filter((item) => item.status === "pending").length;
  const instruction = project.instruction.trim();

  return (
    <aside className="project-rail" aria-label="项目配置">
      <header className="project-rail-head">
        <h2>项目配置</h2>
        {manage ? (
          <button type="button" className="icon-btn" aria-label="编辑设置" onClick={onEdit}>
            <IconPlus size={16} />
          </button>
        ) : null}
      </header>

      <section className="project-rail-block">
        <div className="project-rail-label">
          <span>指令</span>
          <button type="button" className="icon-btn" aria-label="编辑指令" onClick={onEdit}>
            <IconPlus size={14} />
          </button>
        </div>
        <button type="button" className="project-instruction" onClick={onEdit}>
          {instruction || "还没有写项目指令。开对话时不会带上团队规范。"}
        </button>
      </section>

      <section className="project-rail-block">
        <div className="project-rail-label">
          <span>成员</span>
          <button type="button" className="icon-btn" aria-label="管理成员" onClick={onEdit}>
            <IconPlus size={14} />
          </button>
        </div>
        <div className="avatar-stack">
          {project.members.slice(0, 8).map((item) => (
            <span key={item.userId} className="avatar" title={`${item.email} · ${roleLabel(item.role)}`}>
              {initials(item.email)}
            </span>
          ))}
        </div>
        <p className="hint">
          {project.members.length} 人
          {pending > 0 ? ` · ${pending} 个待审批` : ""}
          {project.invitePolicy === "approve" ? " · 加入需审批" : " · 链接即加入"}
        </p>
        <ul className="rail-member-list">
          {project.members.slice(0, 5).map((item) => (
            <li key={item.userId}>
              <span>{displayName(item.email)}</span>
              <em>{roleLabel(item.role)}</em>
            </li>
          ))}
        </ul>
      </section>

      <section className="project-rail-block">
        <div className="project-rail-label">
          <span>仓库</span>
          <button type="button" className="icon-btn" aria-label="编辑仓库" onClick={onEdit}>
            <IconPlus size={14} />
          </button>
        </div>
        {project.defaultRepoUrls.length === 0 ? (
          <p className="hint">还没有默认仓库。项目里开对话时可以再选。</p>
        ) : (
          <ul className="rail-repo-list">
            {project.defaultRepoUrls.map((url) => (
              <li key={url} title={url}>
                {repoShort(url)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
