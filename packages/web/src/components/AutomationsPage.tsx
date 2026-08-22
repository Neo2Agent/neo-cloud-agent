import { useEffect, useState } from "react";
import { describeAutomationSchedule, type Automation, type AutomationSchedule } from "@neo-cloud-agent/contracts/automation";
import { api, readJson } from "../api";

type ScheduleKind = "hourly" | "six_hours" | "daily_09" | "weekly_mon_09";

type NotifySettings = {
  telegram: { configured: boolean; path: string; chatIdSet: boolean };
  wecom: { configured: boolean };
  http: { configured: boolean };
  wechat: { configured: boolean; path: string };
  defaultRepo: string;
  publicAppUrl: string;
};

const PRESETS: Array<{ id: ScheduleKind; label: string; schedule: AutomationSchedule }> = [
  { id: "hourly", label: "每小时", schedule: { kind: "every", minutes: 60 } },
  { id: "six_hours", label: "每 6 小时", schedule: { kind: "every", minutes: 360 } },
  { id: "daily_09", label: "每天上午 9 点", schedule: { kind: "daily", hour: 9 } },
  { id: "weekly_mon_09", label: "每周一上午 9 点", schedule: { kind: "weekly", weekday: 1, hour: 9 } },
];

type Props = {
  token: string;
  onOpenRun?: (id: string) => void;
};

export function AutomationsPage({ token, onOpenRun }: Props) {
  const [items, setItems] = useState<Automation[]>([]);
  const [notify, setNotify] = useState<NotifySettings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<ScheduleKind>("daily_09");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [wecomWebhook, setWecomWebhook] = useState("");
  const [wechatToken, setWechatToken] = useState("");
  const [httpUrl, setHttpUrl] = useState("");
  const [defaultRepo, setDefaultRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    const [autoRes, notifyRes] = await Promise.all([
      api(token, "/v1/automations"),
      api(token, "/v1/settings/notify"),
    ]);
    if (autoRes.ok) {
      const body = await readJson<{ automations?: Automation[] }>(autoRes);
      setItems(body.automations ?? []);
    }
    if (notifyRes.ok) {
      const body = await readJson<NotifySettings>(notifyRes);
      setNotify(body);
      setDefaultRepo(body.defaultRepo || "");
    }
  };

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [token]);

  return (
    <section className="auto-page" id="automations-page">
      <header className="auto-page-head">
        <p className="eyebrow">定时任务</p>
        <h2>到点自动开一场对话</h2>
        <p className="hint">任务会保存下来，可在下面列表里开关或删除。做完可以通知你。</p>
      </header>

      <form
        className="auto-create"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !prompt.trim()) return;
          setBusy(true);
          setError("");
          void api(token, "/v1/automations", {
            method: "POST",
            body: JSON.stringify({
              prompt: prompt.trim(),
              repoUrls: defaultRepo.trim() ? [defaultRepo.trim()] : [],
              schedule: PRESETS.find((item) => item.id === preset)?.schedule,
            }),
          })
            .then(async (response) => {
              if (!response.ok) throw new Error((await readJson<{ error?: string }>(response)).error || "创建失败");
              setPrompt("");
              await refresh();
            })
            .catch((item) => setError(item instanceof Error ? item.message : "创建失败"))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          <span>要做的事</span>
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="每天检查一下仓库有没有测试失败"
          />
        </label>
        <label>
          <span>频率</span>
          <select value={preset} onChange={(event) => setPreset(event.target.value as ScheduleKind)}>
            {PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost" type="submit" disabled={busy || !prompt.trim()}>
          添加任务
        </button>
      </form>

      <div className="auto-list-head">
        <p className="eyebrow">任务列表</p>
        <span className="hint">{items.length} 条</span>
      </div>
      {items.length === 0 ? (
        <p className="auto-empty">还没有定时任务。上面写一句要做的事，选好频率再添加。</p>
      ) : (
        <ul className="auto-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.enabled ? "进行中" : "已暂停"} · {describeAutomationSchedule(item.schedule)}
                  {" · 下次 "}
                  {formatWhen(item.nextRunAt)}
                  {item.lastRunAt ? ` · 上次 ${formatWhen(item.lastRunAt)}` : ""}
                  {item.lastError ? ` · ${item.lastError}` : ""}
                </small>
              </div>
              {item.lastRunId && onOpenRun ? (
                <button className="ghost" type="button" onClick={() => onOpenRun(item.lastRunId!)}>
                  看上次
                </button>
              ) : null}
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  void api(token, `/v1/automations/${item.id}`, {
                    method: "POST",
                    body: JSON.stringify({ enabled: !item.enabled }),
                  }).then(() => refresh());
                }}
              >
                {item.enabled ? "暂停" : "开启"}
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  void api(token, `/v1/automations/${item.id}`, {
                    method: "POST",
                    body: JSON.stringify({ delete: true }),
                  }).then(() => refresh());
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="auto-notify">
        <summary>做完通知 / 发任务</summary>
        <p className="hint">Telegram 或微信公众号发一句就会开新对话；企业微信机器人只用来通知。默认仓库给聊天入口用。</p>
        <div className="env-row llm-row">
          <label>
            <span>默认仓库</span>
            <input value={defaultRepo} onChange={(event) => setDefaultRepo(event.target.value)} placeholder="github.com/org/repo" />
          </label>
          <label>
            <span>Telegram Bot Token</span>
            <input
              type="password"
              autoComplete="new-password"
              value={telegramBotToken}
              placeholder={notify?.telegram.configured ? "已保存，留空则保持" : "123456:ABC…"}
              onChange={(event) => setTelegramBotToken(event.target.value)}
            />
          </label>
          <label>
            <span>企业微信机器人</span>
            <input
              type="password"
              autoComplete="new-password"
              value={wecomWebhook}
              placeholder={notify?.wecom.configured ? "已保存，留空则保持" : "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"}
              onChange={(event) => setWecomWebhook(event.target.value)}
            />
          </label>
          <label>
            <span>微信公众号 Token</span>
            <input
              type="password"
              autoComplete="new-password"
              value={wechatToken}
              placeholder={notify?.wechat.configured ? "已保存，留空则保持" : "和公众号后台填的一样"}
              onChange={(event) => setWechatToken(event.target.value)}
            />
          </label>
          <label>
            <span>通知 HTTP</span>
            <input
              value={httpUrl}
              placeholder={notify?.http.configured ? "已保存，留空则保持" : "https://…"}
              onChange={(event) => setHttpUrl(event.target.value)}
            />
          </label>
          <button
            className="ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void api(token, "/v1/settings/notify", {
                method: "POST",
                body: JSON.stringify({
                  telegramBotToken: telegramBotToken || undefined,
                  wecomWebhook: wecomWebhook || undefined,
                  wechatToken: wechatToken || undefined,
                  httpUrl: httpUrl || undefined,
                  defaultRepo,
                }),
              })
                .then(async (response) => {
                  if (!response.ok) throw new Error((await readJson<{ error?: string }>(response)).error || "保存失败");
                  setTelegramBotToken("");
                  setWecomWebhook("");
                  setWechatToken("");
                  setHttpUrl("");
                  await refresh();
                })
                .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
                .finally(() => setBusy(false));
            }}
          >
            保存通知
          </button>
        </div>
        {notify ? (
          <p className="hint" id="notify-status">
            Telegram {notify.telegram.path}
            {notify.telegram.configured ? (notify.telegram.chatIdSet ? " · 已能通知" : " · 先给机器人发一句") : " · 未配置"}
            {" · "}
            微信 {notify.wechat.path}
            {notify.wechat.configured ? " · 已配置" : " · 未配置"}
            {notify.publicAppUrl ? "" : " · 建议在 .env 设 PUBLIC_APP_URL"}
          </p>
        ) : null}
      </details>
      {error ? <p className="auth-error">{error}</p> : null}
    </section>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
