import { Checkbox, Select } from "@neo-cloud-agent/ui";
import { useEffect, useMemo, useState } from "react";
import type { Expert } from "@neo-cloud-agent/contracts/expert";
import { expertPickerLabel } from "@neo-cloud-agent/contracts/expert";
import { pluginPickerLabel, type PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import { canManageProject, type Project, type ProjectInvite, type ProjectMember } from "@neo-cloud-agent/contracts/project";
import { PROJECT_TEMPLATES, projectTemplateById } from "@neo-cloud-agent/contracts/recipe";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { api, readJson } from "../api";
import { prettyBytes } from "../artifact.js";
import { clampPage, filterByQuery, formatShortDate, paginate, snippet } from "../catalog.js";
import { IconBack, IconDownload, IconPlus, IconTrash } from "../icons.js";
import { CatalogCard, CatalogEmpty, CatalogForm, CatalogGrid, CatalogModal, CatalogPager, CatalogTabs, CatalogToolbar } from "./Catalog.js";

type Props = {
  token: string;
  userId?: string;
  inviteToken?: string | null;
  selectedId?: string | null;
  assetsTab?: boolean;
  highlightAssetId?: string | null;
  onOpenProject: (id: string | null, opts?: { assets?: boolean; assetId?: string | null }) => void;
  onStartChat: (project: Project) => void;
  onOpenRun: (id: string) => void;
};

type DetailTab = "chats" | "assets" | "config" | "members" | "activity";
type ConfigTab = "instruction" | "experts" | "skills";

export function ProjectsPage({
  token,
  userId,
  inviteToken,
  selectedId,
  assetsTab,
  highlightAssetId,
  onOpenProject,
  onStartChat,
  onOpenRun,
}: Props) {
  const [items, setItems] = useState<Project[]>([]);
  const [detail, setDetail] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createInstruction, setCreateInstruction] = useState("");
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
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<DetailTab>(assetsTab ? "assets" : "chats");
  const [configTab, setConfigTab] = useState<ConfigTab>("instruction");
  const [runPage, setRunPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [assetPage, setAssetPage] = useState(1);

  const selected = detail ?? items.find((item) => item.id === selectedId) ?? null;
  const members = selected?.members ?? [];
  const others = members.filter((item) => item.userId !== userId);
  const canManage = canManageProject(members.find((member) => member.userId === userId)?.role);

  const filtered = useMemo(
    () => filterByQuery(items, query, (item) => [item.name, item.instruction]),
    [items, query],
  );
  const listPage = clampPage(page, filtered.length);
  const visible = paginate(filtered, listPage);

  const pending = useMemo(
    () => (selected?.invites ?? []).filter((item) => item.status === "pending"),
    [selected],
  );
  const events = useMemo(
    () => (selected?.events ?? []).slice().reverse(),
    [selected],
  );
  const runListPage = clampPage(runPage, runs.length, 10);
  const visibleRuns = paginate(runs, runListPage, 10);
  const eventListPage = clampPage(eventPage, events.length);
  const visibleEvents = paginate(events, eventListPage);
  const assetListPage = clampPage(assetPage, assets.length, 10);
  const visibleAssets = paginate(assets, assetListPage, 10);

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
    const assetsRes = await api(token, `/v1/projects/${encodeURIComponent(id)}/assets`);
    if (assetsRes.ok) {
      setAssets((await readJson<{ assets?: ProjectAsset[] }>(assetsRes)).assets ?? []);
    } else {
      setAssets([]);
    }
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId).catch(() => undefined);
    } else {
      setDetail(null);
      setAssets([]);
    }
  }, [selectedId, token]);

  useEffect(() => {
    if (!selectedId) return;
    setTab((current) => (assetsTab ? "assets" : current === "assets" ? "chats" : current));
    if (assetsTab) setAssetPage(1);
  }, [selectedId, assetsTab, highlightAssetId]);

  useEffect(() => {
    if (selectedId && highlightAssetId) {
      void loadDetail(selectedId).catch(() => undefined);
    }
  }, [highlightAssetId]);

  useEffect(() => {
    if (!highlightAssetId) return;
    document.getElementById(`asset-${highlightAssetId}`)?.scrollIntoView({ block: "center" });
  }, [highlightAssetId, assets]);

  useEffect(() => {
    setPage(1);
  }, [query]);

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

  const createProject = () => {
    if (busy || !createName.trim()) return;
    setBusy(true);
    setError("");
    const template = projectTemplateById(templateId);
    void api(token, "/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        name: createName.trim(),
        instruction: createInstruction.trim() || template?.instruction || "",
        expertIds: template?.expertIds,
        pluginIds: template?.pluginIds,
      }),
    })
      .then(async (res) => {
        const body = await readJson<Project & { error?: string }>(res);
        if (!res.ok) throw new Error(body.error || "创建失败");
        setCreateName("");
        setCreateInstruction("");
        setTemplateId("");
        setCreateOpen(false);
        await refresh();
        onOpenProject(body.id);
      })
      .catch((item) => setError(item instanceof Error ? item.message : "创建失败"))
      .finally(() => setBusy(false));
  };

  const saveProject = (body: Record<string, unknown>) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    void api(token, `/v1/projects/${selected.id}`, {
      method: "POST",
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await readJson<{ error?: string }>(res)).error || "保存失败");
        await loadDetail(selected.id);
      })
      .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
      .finally(() => setBusy(false));
  };

  if (inviteToken) {
    return (
      <section className="proj-page catalog-page" id="projects-page">
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
      <section className="proj-page catalog-page" id="projects-page">
        <header className="proj-page-head">
          <div>
            <button className="catalog-back" type="button" onClick={() => onOpenProject(null)}>
              <IconBack />
              全部项目
            </button>
            <h2>{selected.name}</h2>
            <p className="hint">
              {selected.members.length} 位成员 · {runs.length} 条对话 · {assets.length} 个资产
            </p>
          </div>
          <button className="proj-add" type="button" onClick={() => onStartChat(selected)}>
            在项目里开对话
          </button>
        </header>

        <CatalogTabs
          tabs={[
            { id: "chats", label: "对话", count: runs.length },
            { id: "assets", label: "资产", count: assets.length },
            { id: "config", label: "配置" },
            { id: "members", label: "成员", count: members.length },
            { id: "activity", label: "动态", count: events.length },
          ]}
          active={tab}
          onChange={(id) => {
            setTab(id);
            onOpenProject(selected.id, id === "assets" ? { assets: true, assetId: highlightAssetId } : undefined);
          }}
        />

        {tab === "chats" ? (
          <div className="catalog-panel">
            {runs.length === 0 ? (
              <CatalogEmpty
                title="还没有对话"
                hint="点右上角「在项目里开对话」，项目指令会自动带上。"
                action={
                  <button className="proj-add" type="button" onClick={() => onStartChat(selected)}>
                    开对话
                  </button>
                }
              />
            ) : (
              <>
                <ul className="proj-runs">
                  {visibleRuns.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => onOpenRun(item.id)}>
                        <strong>{item.prompt}</strong>
                        <small>
                          {item.assigneeUserId === userId ? "交给我" : "项目对话"}
                          {item.createdAt ? ` · ${formatShortDate(item.createdAt)}` : ""}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
                <CatalogPager page={runListPage} total={runs.length} pageSize={10} onPage={setRunPage} />
              </>
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
        ) : null}

        {tab === "assets" ? (
          <div className="catalog-panel">
            <div className="proj-asset-toolbar">
              <p className="hint">对话里的文件要手动保存过来，不会自动进项目。</p>
              <label className="catalog-create file-upload">
                <IconPlus />
                上传文件
                <input
                  type="file"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = String(reader.result ?? "");
                      const content = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
                      setBusy(true);
                      setError("");
                      void api(token, `/v1/projects/${selected.id}/assets`, {
                        method: "POST",
                        body: JSON.stringify({
                          path: file.name,
                          content,
                          encoding: "base64",
                          contentType: file.type || undefined,
                        }),
                      })
                        .then(async (res) => {
                          const body = await readJson<ProjectAsset & { error?: string }>(res);
                          if (!res.ok) throw new Error(body.error || "上传失败");
                          await loadDetail(selected.id);
                          onOpenProject(selected.id, { assets: true, assetId: body.id });
                        })
                        .catch((item) => setError(item instanceof Error ? item.message : "上传失败"))
                        .finally(() => setBusy(false));
                    };
                    reader.readAsDataURL(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {assets.length === 0 ? (
              <CatalogEmpty title="还没有项目资产" hint="上传文件，或从对话产物里点「保存到项目」。" />
            ) : (
              <>
                <ul className="proj-assets">
                  {visibleAssets.map((item) => (
                    <li
                      key={item.id}
                      id={`asset-${item.id}`}
                      data-highlight={highlightAssetId === item.id ? "true" : undefined}
                    >
                      <span className="proj-asset-copy">
                        <span className="proj-asset-title">
                          <strong>{item.path}</strong>
                          <em className="catalog-badge">{item.source === "run" ? "来自对话" : "上传"}</em>
                        </span>
                        <small>
                          {prettyBytes(item.size)}
                          {item.updatedEmail || item.createdEmail
                            ? ` · ${item.updatedEmail || item.createdEmail}`
                            : ""}
                          {item.updatedAt ? ` · ${formatShortDate(item.updatedAt)}` : ""}
                        </small>
                      </span>
                      <span className="proj-asset-actions">
                        <button
                          className="quiet-btn"
                          type="button"
                          onClick={() => {
                            void api(token, `/v1/projects/${selected.id}/assets/${item.id}`)
                              .then(async (response) => {
                                if (!response.ok) throw new Error("下载失败");
                                const blob = await response.blob();
                                const url = URL.createObjectURL(blob);
                                const link = document.createElement("a");
                                link.href = url;
                                link.download = item.path.split("/").pop() ?? item.path;
                                link.click();
                                URL.revokeObjectURL(url);
                              })
                              .catch((err) => setError(err instanceof Error ? err.message : "下载失败"));
                          }}
                        >
                          <IconDownload size={14} />
                          下载
                        </button>
                        {canManage ? (
                          <button
                            className="quiet-btn danger"
                            type="button"
                            onClick={() => {
                              setBusy(true);
                              void api(token, `/v1/projects/${selected.id}/assets/${item.id}`, { method: "DELETE" })
                                .then(async (res) => {
                                  if (!res.ok) {
                                    throw new Error((await readJson<{ error?: string }>(res)).error || "删除失败");
                                  }
                                  await loadDetail(selected.id);
                                  if (highlightAssetId === item.id) onOpenProject(selected.id, { assets: true });
                                })
                                .catch((err) => setError(err instanceof Error ? err.message : "删除失败"))
                                .finally(() => setBusy(false));
                            }}
                          >
                            <IconTrash size={14} />
                            删除
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <CatalogPager page={assetListPage} total={assets.length} pageSize={10} onPage={setAssetPage} />
              </>
            )}
          </div>
        ) : null}

        {tab === "config" ? (
          <div className="catalog-panel">
            <CatalogTabs
              tabs={[
                { id: "instruction", label: "指令" },
                { id: "experts", label: "专家", count: pinnedIds.length },
                { id: "skills", label: "技能", count: pinnedPluginIds.length },
              ]}
              active={configTab}
              onChange={setConfigTab}
            />
            {configTab === "instruction" ? (
              <form
                className="proj-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveProject({ instruction });
                }}
              >
                <p className="proj-card-title">项目指令</p>
                <p className="hint">写给 AI 的团队规则。这个项目里开的对话都会自动带上。</p>
                <textarea
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  rows={6}
                  placeholder="例如：用中文回复，改代码先跑测试，提交信息写清楚。"
                />
                <button className="proj-add" type="submit" disabled={busy}>
                  保存指令
                </button>
              </form>
            ) : null}
            {configTab === "experts" ? (
              <form
                className="proj-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveProject({ expertIds: pinnedIds });
                }}
              >
                <p className="proj-card-title">项目专家</p>
                <p className="hint">置顶后，这个项目里开对话时专家选择器会把它们排在前面。</p>
                <ul className="expert-pin-list">
                  {catalog.map((item) => (
                    <li key={item.id}>
                      <Checkbox
                        checked={pinnedIds.includes(item.id)}
                        disabled={!canManage}
                        label={expertPickerLabel(item)}
                        onCheckedChange={(checked) => {
                          setPinnedIds((prev) => (checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)));
                        }}
                      />
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <button className="proj-add" type="submit" disabled={busy}>
                    保存置顶
                  </button>
                ) : (
                  <p className="hint">只有所有者或管理员能改置顶。</p>
                )}
              </form>
            ) : null}
            {configTab === "skills" ? (
              <form
                className="proj-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveProject({ pluginIds: pinnedPluginIds });
                }}
              >
                <p className="proj-card-title">项目技能</p>
                <p className="hint">钉住后，这个项目里开的对话会把对应 SKILL.md 写进工作区，不必每人自己安装。</p>
                <ul className="expert-pin-list">
                  {pluginCatalog.map((item) => (
                    <li key={item.id}>
                      <Checkbox
                        checked={pinnedPluginIds.includes(item.id) || pinnedPluginIds.includes(item.slug)}
                        disabled={!canManage}
                        label={pluginPickerLabel(item)}
                        onCheckedChange={(checked) => {
                          setPinnedPluginIds((prev) =>
                            checked ? [...prev, item.id] : prev.filter((id) => id !== item.id && id !== item.slug),
                          );
                        }}
                      />
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <button className="proj-add" type="submit" disabled={busy}>
                    保存技能
                  </button>
                ) : (
                  <p className="hint">只有所有者或管理员能改项目技能。</p>
                )}
              </form>
            ) : null}
          </div>
        ) : null}

        {tab === "members" ? (
          <div className="catalog-panel">
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
          </div>
        ) : null}

        {tab === "activity" ? (
          <div className="catalog-panel">
            {events.length === 0 ? (
              <CatalogEmpty title="还没有动态" hint="改指令、加人、开对话会出现在这里。" />
            ) : (
              <>
                <ul className="proj-events">
                  {visibleEvents.map((item) => (
                    <li key={item.id}>
                      <strong>{item.actorEmail}</strong>
                      <span>{item.detail}</span>
                    </li>
                  ))}
                </ul>
                <CatalogPager page={eventListPage} total={events.length} onPage={setEventPage} />
              </>
            )}
          </div>
        ) : null}

        {error ? <p className="auth-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="proj-page catalog-page" id="projects-page">
      <header className="proj-page-head">
        <div>
          <p className="eyebrow">项目</p>
          <h2>人和 Agent 共用一份上下文</h2>
        </div>
      </header>

      <CatalogToolbar
        search={query}
        onSearch={setQuery}
        placeholder="搜索项目"
        actionLabel="新建项目"
        onAction={() => {
          setCreateName("");
          setCreateInstruction("");
          setTemplateId("");
          setCreateOpen(true);
        }}
      />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={items.length === 0 ? "还没有项目" : "没有匹配的项目"}
          hint={items.length === 0 ? "建一个项目，把团队规则写进去。之后开对话不用每次重讲。" : "换个关键词再试试。"}
          action={
            items.length === 0 ? (
              <button className="proj-add" type="button" onClick={() => setCreateOpen(true)}>
                新建项目
              </button>
            ) : null
          }
        />
      ) : (
        <>
          <CatalogGrid>
            {visible.map((item) => (
              <CatalogCard
                key={item.id}
                title={item.name}
                description={snippet(item.instruction, 80) || "还没写指令"}
                badge={`${item.members.length} 人`}
                meta={item.createdAt ? `添加于 ${formatShortDate(item.createdAt)}` : undefined}
                onOpen={() => onOpenProject(item.id)}
              />
            ))}
          </CatalogGrid>
          <CatalogPager page={listPage} total={filtered.length} onPage={setPage} />
        </>
      )}

      <CatalogModal
        title="新建项目"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button type="button" className="proj-add" disabled={busy || !createName.trim()} onClick={createProject}>
              创建项目
            </button>
          </>
        }
      >
        <CatalogForm
          onSubmit={(event) => {
            event.preventDefault();
            createProject();
          }}
        >
          <label>
            <span>模板</span>
            <Select
              value={templateId}
              onValueChange={(value) => {
                setTemplateId(value);
                const template = projectTemplateById(value);
                if (template && !createInstruction.trim()) setCreateInstruction(template.instruction);
                if (template && !createName.trim()) setCreateName(template.name);
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
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="例如：官网改版"
              autoComplete="off"
              autoFocus
            />
          </label>
          <label>
            <span>项目指令</span>
            <textarea
              value={createInstruction}
              onChange={(event) => setCreateInstruction(event.target.value)}
              rows={4}
              placeholder="给这个项目里所有对话看的规则，可先留空"
            />
          </label>
        </CatalogForm>
      </CatalogModal>
      {error ? <p className="auth-error">{error}</p> : null}
    </section>
  );
}

function roleLabel(role: ProjectMember["role"]): string {
  if (role === "owner") return "所有者";
  if (role === "admin") return "管理员";
  return "成员";
}
