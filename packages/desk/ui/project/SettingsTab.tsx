import { expertPickerLabel, type Expert } from "@neo-cloud-agent/contracts/expert";
import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { canManageProject, type InvitePolicy, type Project } from "@neo-cloud-agent/contracts/project";
import { Checkbox, Select } from "@neo-cloud-agent/ui";
import { useEffect, useState } from "react";
import { api, readJson } from "../api";
import { roleLabel } from "./helpers";

export function SettingsTab({
  token,
  project,
  userId,
  onChanged,
}: {
  token: string;
  project: Project;
  userId: string;
  onChanged: (project: Project) => void;
}) {
  const manage = canManageProject(project.members.find((item) => item.userId === userId)?.role);
  const [name, setName] = useState(project.name);
  const [instruction, setInstruction] = useState(project.instruction);
  const [repos, setRepos] = useState(project.defaultRepoUrls.join("\n"));
  const [policy, setPolicy] = useState<InvitePolicy>(project.invitePolicy);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<Expert[]>([]);
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalogItem[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>(project.expertIds ?? []);
  const [pinnedPluginIds, setPinnedPluginIds] = useState<string[]>(project.pluginIds ?? []);

  useEffect(() => {
    setName(project.name);
    setInstruction(project.instruction);
    setRepos(project.defaultRepoUrls.join("\n"));
    setPolicy(project.invitePolicy);
    setPinnedIds(project.expertIds ?? []);
    setPinnedPluginIds(project.pluginIds ?? []);
  }, [project]);

  useEffect(() => {
    void api(token, `/v1/experts?projectId=${encodeURIComponent(project.id)}`)
      .then(async (response) => {
        if (!response.ok) return;
        setCatalog((await readJson<{ experts?: Expert[] }>(response)).experts ?? []);
      })
      .catch(() => undefined);
    void api(token, `/v1/plugins?projectId=${encodeURIComponent(project.id)}`)
      .then(async (response) => {
        if (!response.ok) return;
        setPluginCatalog((await readJson<{ plugins?: PluginCatalogItem[] }>(response)).plugins ?? []);
      })
      .catch(() => undefined);
  }, [project.id, token]);

  const save = async () => {
    if (!manage || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/projects/${project.id}`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          instruction,
          defaultRepoUrls: repos
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          invitePolicy: policy,
        }),
      });
      const body = await readJson<Project & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "保存失败");
      onChanged(body);
    } catch (item) {
      setError(item instanceof Error ? item.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!manage || !memberEmail.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/projects/${project.id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: memberEmail.trim(), password: memberPassword || undefined }),
      });
      const body = await readJson<Project & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "添加失败");
      setMemberEmail("");
      setMemberPassword("");
      onChanged(body);
    } catch (item) {
      setError(item instanceof Error ? item.message : "添加失败");
    } finally {
      setBusy(false);
    }
  };

  const makeInvite = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/projects/${project.id}/invites`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const body = await readJson<{ token?: string; url?: string; error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "创建失败");
      const url = body.url || `${location.origin}/#/invite/${body.token ?? ""}`;
      setInviteUrl(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
    } catch (item) {
      setError(item instanceof Error ? item.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (tokenId: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/projects/${project.id}/invites/${tokenId}/approve`, { method: "POST" });
      const body = await readJson<Project & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "审批失败");
      onChanged(body);
    } catch (item) {
      setError(item instanceof Error ? item.message : "审批失败");
    } finally {
      setBusy(false);
    }
  };

  const pending = project.invites.filter((item) => item.status === "pending");

  return (
    <div className="workbench-stack">
      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2>项目设置</h2>
        <label>
          <span>名称</span>
          <input value={name} maxLength={15} disabled={!manage} onChange={(event) => setName(event.target.value.slice(0, 15))} />
        </label>
        <label>
          <span>指令</span>
          <textarea value={instruction} disabled={!manage} onChange={(event) => setInstruction(event.target.value)} rows={6} />
        </label>
        <label>
          <span>默认仓库</span>
          <textarea
            value={repos}
            disabled={!manage}
            onChange={(event) => setRepos(event.target.value)}
            rows={3}
            placeholder="每行一个 git URL"
          />
        </label>
        <label>
          <span>邀请策略</span>
          <Select
            value={policy}
            disabled={!manage}
            onValueChange={(value) => setPolicy(value as InvitePolicy)}
            options={[
              { value: "approve", label: "需要审批" },
              { value: "open", label: "链接即加入" },
            ]}
          />
        </label>
        {manage ? (
          <button type="submit" className="dash-create" disabled={busy}>
            {busy ? "保存中…" : "保存设置"}
          </button>
        ) : (
          <p className="hint">只有所有者或管理员能改设置。</p>
        )}
      </form>

      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!manage || busy) return;
          setBusy(true);
          setError("");
          void api(token, `/v1/projects/${project.id}`, {
            method: "POST",
            body: JSON.stringify({ expertIds: pinnedIds }),
          })
            .then(async (response) => {
              const body = await readJson<Project & { error?: string }>(response);
              if (!response.ok) throw new Error(body.error || "保存失败");
              onChanged(body);
            })
            .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
            .finally(() => setBusy(false));
        }}
      >
        <h2>项目专家</h2>
        <p className="hint">置顶后，这个项目里开对话时专家选择器会把它们排在前面。</p>
        <ul className="expert-pin-list">
          {catalog.map((item) => (
            <li key={item.id}>
              <Checkbox
                checked={pinnedIds.includes(item.id)}
                disabled={!manage}
                label={expertPickerLabel(item)}
                onCheckedChange={(checked) => {
                  setPinnedIds((prev) => (checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)));
                }}
              />
            </li>
          ))}
        </ul>
        {manage ? (
          <button type="submit" className="dash-create" disabled={busy}>
            保存置顶
          </button>
        ) : null}
      </form>

      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!manage || busy) return;
          setBusy(true);
          setError("");
          void api(token, `/v1/projects/${project.id}`, {
            method: "POST",
            body: JSON.stringify({ pluginIds: pinnedPluginIds }),
          })
            .then(async (response) => {
              const body = await readJson<Project & { error?: string }>(response);
              if (!response.ok) throw new Error(body.error || "保存失败");
              onChanged(body);
            })
            .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
            .finally(() => setBusy(false));
        }}
      >
        <h2>项目技能</h2>
        <p className="hint">钉住后，这个项目里开的对话会把对应 SKILL.md 写进工作区。</p>
        <ul className="expert-pin-list">
          {pluginCatalog.map((item) => (
            <li key={item.id}>
              <Checkbox
                checked={pinnedPluginIds.includes(item.id) || pinnedPluginIds.includes(item.slug)}
                disabled={!manage}
                label={pluginPickerLabel(item)}
                onCheckedChange={(checked) => {
                  setPinnedPluginIds((prev) => (checked ? [...prev, item.id] : prev.filter((id) => id !== item.id && id !== item.slug)));
                }}
              />
            </li>
          ))}
        </ul>
        {manage ? (
          <button type="submit" className="dash-create" disabled={busy}>
            保存技能
          </button>
        ) : null}
      </form>

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
        {manage ? (
          <form
            className="member-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addMember();
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
            <button type="submit" className="ghost" disabled={busy || !memberEmail.trim()}>
              添加成员
            </button>
          </form>
        ) : null}
        <div className="invite-row">
          <button type="button" className="ghost" disabled={busy} onClick={() => void makeInvite()}>
            生成并复制邀请链接
          </button>
          {inviteUrl ? <input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /> : null}
        </div>
        {pending.length > 0 && manage ? (
          <ul className="pending-list">
            {pending.map((item) => (
              <li key={item.token}>
                <span>{item.requestedEmail} 申请加入</span>
                <button type="button" className="ghost" onClick={() => void approve(item.token)}>
                  通过
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
