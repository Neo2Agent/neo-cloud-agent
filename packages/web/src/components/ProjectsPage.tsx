import { Checkbox, Select } from "@neo-cloud-agent/ui";
import { useEffect, useMemo, useState } from "react";
import type { Expert } from "@neo-cloud-agent/contracts/expert";
import { expertPickerLabel } from "@neo-cloud-agent/contracts/expert";
import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { canManageProject, type Project, type ProjectInvite, type ProjectMember } from "@neo-cloud-agent/contracts/project";
import { PROJECT_TEMPLATES, projectTemplateById } from "@neo-cloud-agent/contracts/recipe";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { api, readJson } from "../api";

type Props = {
  token: string;
  userId?: string;
  inviteToken?: string | null;
  selectedId?: string | null;
  onOpenProject: (id: string | null) => void;
  onStartChat: (project: Project) => void;
  onOpenRun: (id: string) => void;
};

export function ProjectsPage({ token, userId, inviteToken, selectedId, onOpenProject, onStartChat, onOpenRun }: Props) {
  const [items, setItems] = useState<Project[]>([]);
  const [detail, setDetail] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [transferRunId, setTransferRunId] = useState("");
  const [transferUserId, setTransferUserId] = useState("");
  const [inviteInfo, setInviteInfo] = useState<{ projectName: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<Expert[]>([]);
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalogItem[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pinnedPluginIds, setPinnedPluginIds] = useState<string[]>([]);

  const selected = detail ?? items.find((item) => item.id === selectedId) ?? null;
  const members = selected?.members ?? [];
  const others = members.filter((item) => item.userId !== userId);

  const refresh = async () => {
    const res = await api(token, "/v1/projects");
    if (res.ok) {
      const body = await readJson<{ projects?: Project[] }>(res);
      setItems(body.projects ?? []);
    }
  };

  const loadDetail = async (id: string) => {
    const [projectRes, runsRes] = await Promise.all([api(token, `/v1/projects/${id}`), api(token, "/v1/runs")]);
    if (projectRes.ok) {
      const project = await readJson<Project>(projectRes);
      setDetail(project);
      setInstruction(project.instruction);
      setPinnedIds(project.expertIds ?? []);
      setPinnedPluginIds(project.pluginIds ?? []);
    }
    const [expertRes, pluginRes] = await Promise.all([
      api(token, `/v1/experts?projectId=${encodeURIComponent(id)}`),
      api(token, `/v1/plugins?projectId=${encodeURIComponent(id)}`),
    ]);
    if (expertRes.ok) {
      setCatalog((await readJson<{ experts?: Expert[] }>(expertRes)).experts ?? []);
    }
    if (pluginRes.ok) {
      setPluginCatalog((await readJson<{ plugins?: PluginCatalogItem[] }>(pluginRes)).plugins ?? []);
    }
    if (runsRes.ok) {
      const body = await readJson<{ runs?: Run[] }>(runsRes);
      setRuns((body.runs ?? []).filter((item) => item.projectId === id));
    }
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId).catch(() => undefined);
    else setDetail(null);
  }, [selectedId, token]);

  useEffect(() => {
    if (!inviteToken) {
      setInviteInfo(null);
      return;
    }
    void api(token, `/v1/invites/${inviteToken}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("邀请无效或已过期");
        const body = await readJson<{ projectName: string; status: string }>(res);
        setInviteInfo(body);
      })
      .catch((item) => setError(item instanceof Error ? item.message : "邀请无效"));
  }, [inviteToken, token]);

  const pending = useMemo(
    () => (selected?.invites ?? []).filter((item) => item.status === "pending"),
    [selected],
  );

  if (inviteToken) {
    return (
      <section className="proj-page" id="projects-page">
        <header className="proj-page-head">
          <div>
            <p className="eyebrow">项目邀请</p>
            <h2>{inviteInfo?.projectName || "加入项目"}</h2>
          </div>
        </header>
        <div className="proj-card">
          <p className="proj-card-title">{inviteInfo?.projectName || "项目邀请"}</p>
          <p className="hint">加入后能看到这个项目的指令、成员和对话，也可以自己开新对话。</p>
          <button
            className="proj-add"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void api(token, `/v1/invites/${inviteToken}`, { method: "POST", body: JSON.stringify({}) })
                .then(async (res) => {
                  const body = await readJson<Project & { error?: string }>(res);
                  if (!res.ok) throw new Error(body.error || "加入失败");
                  onOpenProject(body.id);
                })
                .catch((item) => setError(item instanceof Error ? item.message : "加入失败"))
                .finally(() => setBusy(false));
            }}
          >
            {inviteInfo?.status === "pending" ? "已申请，等待通过" : "加入项目"}
          </button>
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
      </section>
    );
  }

  if (selected) {
    return (
      <section className="proj-page" id="projects-page">
        <header className="proj-page-head">
          <div>
            <button className="ghost" type="button" onClick={() => onOpenProject(null)}>
              全部项目
            </button>
            <h2>{selected.name}</h2>
            <p className="hint">{selected.members.length} 位成员 · {runs.length} 条对话</p>
          </div>
          <button className="proj-add" type="button" onClick={() => onStartChat(selected)}>
            在项目里开对话
          </button>
        </header>

        <form
          className="proj-card"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void api(token, `/v1/projects/${selected.id}`, {
              method: "POST",
              body: JSON.stringify({ instruction }),
            })
              .then(async (res) => {
                if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "保存失败");
                await loadDetail(selected.id);
              })
              .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
              .finally(() => setBusy(false));
          }}
        >
          <p className="proj-card-title">项目指令</p>
          <p className="hint">写给 AI 的团队规则。这个项目里开的对话都会自动带上。</p>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={5}
            placeholder="例如：用中文回复，改代码先跑测试，提交信息写清楚。"
          />
          <button className="proj-add" type="submit" disabled={busy}>
            保存指令
          </button>
        </form>

        <form
          className="proj-card"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void api(token, `/v1/projects/${selected.id}`, {
              method: "POST",
              body: JSON.stringify({ expertIds: pinnedIds }),
            })
              .then(async (res) => {
                if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "保存失败");
                await loadDetail(selected.id);
              })
              .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
              .finally(() => setBusy(false));
          }}
        >
          <p className="proj-card-title">项目专家</p>
          <p className="hint">置顶后，这个项目里开对话时专家选择器会把它们排在前面。</p>
          <ul className="expert-pin-list">
            {catalog.map((item) => (
              <li key={item.id}>
                <Checkbox
                  checked={pinnedIds.includes(item.id)}
                  disabled={!canManageProject(members.find((member) => member.userId === userId)?.role)}
                  label={expertPickerLabel(item)}
                  onCheckedChange={(checked) => {
                    setPinnedIds((prev) => (checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)));
                  }}
                />
              </li>
            ))}
          </ul>
          {canManageProject(members.find((member) => member.userId === userId)?.role) ? (
            <button className="proj-add" type="submit" disabled={busy}>
              保存置顶
            </button>
          ) : (
            <p className="hint">只有所有者或管理员能改置顶。</p>
          )}
        </form>

        <form
          className="proj-card"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void api(token, `/v1/projects/${selected.id}`, {
              method: "POST",
              body: JSON.stringify({ pluginIds: pinnedPluginIds }),
            })
              .then(async (res) => {
                if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "保存失败");
                await loadDetail(selected.id);
              })
              .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
              .finally(() => setBusy(false));
          }}
        >
          <p className="proj-card-title">项目技能</p>
          <p className="hint">钉住后，这个项目里开的对话会把对应 SKILL.md 写进工作区，不必每人自己安装。</p>
          <ul className="expert-pin-list">
            {pluginCatalog.map((item) => (
              <li key={item.id}>
                <Checkbox
                  checked={pinnedPluginIds.includes(item.id) || pinnedPluginIds.includes(item.slug)}
                  disabled={!canManageProject(members.find((member) => member.userId === userId)?.role)}
                  label={pluginPickerLabel(item)}
                  onCheckedChange={(checked) => {
                    setPinnedPluginIds((prev) => (checked ? [...prev, item.id] : prev.filter((id) => id !== item.id && id !== item.slug)));
                  }}
                />
              </li>
            ))}
          </ul>
          {canManageProject(members.find((member) => member.userId === userId)?.role) ? (
            <button className="proj-add" type="submit" disabled={busy}>
              保存技能
            </button>
          ) : (
            <p className="hint">只有所有者或管理员能改项目技能。</p>
          )}
        </form>

        <div className="proj-grid">
          <div className="proj-card">
            <p className="proj-card-title">成员</p>
            <ul className="proj-members">
              {members.map((item) => (
                <li key={item.userId}>
                  <strong>{item.email}</strong>
                  <span className={`proj-badge ${item.role}`}>{roleLabel(item.role)}</span>
                </li>
              ))}
            </ul>
            <form
              className="proj-member-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!memberEmail.trim()) return;
                setBusy(true);
                setError("");
                void api(token, `/v1/projects/${selected.id}/members`, {
                  method: "POST",
                  body: JSON.stringify({ email: memberEmail.trim(), password: memberPassword || undefined }),
                })
                  .then(async (res) => {
                    if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "添加失败");
                    setMemberEmail("");
                    setMemberPassword("");
                    await loadDetail(selected.id);
                  })
                  .catch((item) => setError(item instanceof Error ? item.message : "添加失败"))
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                <span>账号</span>
                <input value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="同事账号" autoComplete="off" />
              </label>
              <label>
                <span>新账号密码</span>
                <input
                  type="password"
                  value={memberPassword}
                  onChange={(event) => setMemberPassword(event.target.value)}
                  placeholder="已有账号可留空"
                  autoComplete="off"
                />
              </label>
              <button className="ghost" type="submit" disabled={busy || !memberEmail.trim()}>
                添加成员
              </button>
            </form>
            <div className="proj-invite-row">
              <button
                className="ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api(token, `/v1/projects/${selected.id}/invites`, { method: "POST", body: JSON.stringify({}) })
                    .then(async (res) => {
                      const body = await readJson<ProjectInvite & { url?: string; error?: string }>(res);
                      if (!res.ok) throw new Error(body.error || "创建失败");
                      setInviteUrl(body.url || `${location.origin}/#/invite/${body.token}`);
                    })
                    .catch((item) => setError(item instanceof Error ? item.message : "创建失败"))
                    .finally(() => setBusy(false));
                }}
              >
                生成邀请链接
              </button>
              {inviteUrl ? <input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /> : null}
            </div>
            {pending.length > 0 ? (
              <ul className="proj-pending">
                {pending.map((item) => (
                  <li key={item.token}>
                    <span>{item.requestedEmail} 申请加入</span>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => {
                        void api(token, `/v1/projects/${selected.id}/invites/${item.token}/approve`, { method: "POST" }).then(
                          () => loadDetail(selected.id),
                        );
                      }}
                    >
                      通过
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="proj-card">
            <p className="proj-card-title">项目对话</p>
            {runs.length === 0 ? (
              <div className="proj-empty">
                <strong>还没有对话</strong>
                <p>点右上角「在项目里开对话」，指令会自动带上。</p>
              </div>
            ) : (
              <ul className="proj-runs">
                {runs.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onOpenRun(item.id)}>
                      <strong>{item.prompt}</strong>
                      <small>{item.assigneeUserId === userId ? "交给我" : "项目对话"}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {others.length > 0 && runs.length > 0 ? (
              <form
                className="proj-member-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!transferRunId || !transferUserId) return;
                  setBusy(true);
                  void api(token, `/v1/runs/${transferRunId}/transfer`, {
                    method: "POST",
                    body: JSON.stringify({ toUserId: transferUserId, note: transferNote.trim() || undefined }),
                  })
                    .then(async (res) => {
                      if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "转交失败");
                      await loadDetail(selected.id);
                    })
                    .catch((item) => setError(item instanceof Error ? item.message : "转交失败"))
                    .finally(() => setBusy(false));
                }}
              >
                <label>
                  <span>转交对话</span>
                  <Select
                    value={transferRunId}
                    onValueChange={setTransferRunId}
                    placeholder="选择对话"
                    options={[
                      { value: "", label: "选择对话" },
                      ...runs.map((item) => ({ value: item.id, label: item.prompt.slice(0, 32) })),
                    ]}
                  />
                </label>
                <label>
                  <span>交给</span>
                  <Select
                    value={transferUserId}
                    onValueChange={setTransferUserId}
                    placeholder="选择成员"
                    options={[
                      { value: "", label: "选择成员" },
                      ...others.map((item) => ({ value: item.userId, label: item.email })),
                    ]}
                  />
                </label>
                <label>
                  <span>交接说明</span>
                  <input value={transferNote} onChange={(event) => setTransferNote(event.target.value)} placeholder="可选，会写进 HANDOFF.md" />
                </label>
                <p className="hint">对话记录会交给对方。不会拷 .env、密钥或 SCM 凭证。</p>
                <button className="ghost" type="submit" disabled={busy || !transferRunId || !transferUserId}>
                  转交
                </button>
              </form>
            ) : null}
          </div>
        </div>

        {selected.events.length > 0 ? (
          <div className="proj-card">
            <p className="proj-card-title">动态</p>
            <ul className="proj-events">
              {selected.events
                .slice()
                .reverse()
                .slice(0, 12)
                .map((item) => (
                  <li key={item.id}>
                    <strong>{item.actorEmail}</strong>
                    <span>{item.detail}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        {error ? <p className="auth-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="proj-page" id="projects-page">
      <header className="proj-page-head">
        <div>
          <p className="eyebrow">项目</p>
          <h2>人和 Agent 共用一份上下文</h2>
        </div>
        <p className="proj-count">{items.length} 个项目</p>
      </header>

      <form
        className="proj-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          setError("");
          const template = projectTemplateById(templateId);
          void api(token, "/v1/projects", {
            method: "POST",
            body: JSON.stringify({
              name: name.trim(),
              instruction: instruction.trim() || template?.instruction || "",
              expertIds: template?.expertIds,
              pluginIds: template?.pluginIds,
            }),
          })
            .then(async (res) => {
              const body = await readJson<Project & { error?: string }>(res);
              if (!res.ok) throw new Error(body.error || "创建失败");
              setName("");
              setInstruction("");
              setTemplateId("");
              await refresh();
              onOpenProject(body.id);
            })
            .catch((item) => setError(item instanceof Error ? item.message : "创建失败"))
            .finally(() => setBusy(false));
        }}
      >
        <p className="proj-card-title">新建项目</p>
        <label>
          <span>模板</span>
          <Select
            value={templateId}
            onValueChange={(value) => {
              setTemplateId(value);
              const template = projectTemplateById(value);
              if (template && !instruction.trim()) setInstruction(template.instruction);
              if (template && !name.trim()) setName(template.name);
            }}
            placeholder="空白项目"
            options={[
              { value: "", label: "空白项目" },
              ...PROJECT_TEMPLATES.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </label>
        <label>
          <span>名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：官网改版" autoComplete="off" />
        </label>
        <label>
          <span>项目指令</span>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={3}
            placeholder="给这个项目里所有对话看的规则，可先留空"
          />
        </label>
        <button className="proj-add" type="submit" disabled={busy || !name.trim()}>
          创建项目
        </button>
      </form>

      {items.length === 0 ? (
        <div className="proj-empty">
          <strong>还没有项目</strong>
          <p>建一个项目，把团队规则写进去。之后开对话不用每次重讲。</p>
        </div>
      ) : (
        <ul className="proj-list">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onOpenProject(item.id)}>
                <div className="proj-item-top">
                  <strong>{item.name}</strong>
                  <span className="proj-badge">{item.members.length} 人</span>
                </div>
                <p>{item.instruction || "还没写指令"}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="auth-error">{error}</p> : null}
    </section>
  );
}

function roleLabel(role: ProjectMember["role"]): string {
  if (role === "owner") return "所有者";
  if (role === "admin") return "管理员";
  return "成员";
}
