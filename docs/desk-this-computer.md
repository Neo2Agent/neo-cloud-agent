# This Computer 工作区（一期）

产品口径 + 技术方案。对照：[desk.md](./desk.md)（已落地行为）、[desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md)（二期 RPC，另一条线）。

---

## 0. 结论先行

1. **This Computer 和 Remote Control 是 composer 上两个本机目标，按对话记。** 执行都是本机文件夹 + 同一套 Desk worker（一回合起、一回合退）。差别只在这条 run 谁看得见。
2. **This Computer**：只留在这台 Desk。网页 / 手机列表、打开、跟进都当不存在。
3. **Remote Control**：同一套本机执行，但 `executionTarget.remoteControl === true`。网页 / 手机看得到；**Desk 在线**时可在别处续聊。不做「网页新开一条派到这台电脑」，也不上报文件夹清单。
4. **工作区记在这条 run 上**：`deskId` + `repoUrls[0]`。不记在 `desk.workspaces`。不传 `deskWorkspaceId` / `dws_local_*`。
5. 没有字段的旧本机 run 一律当 This Computer（默认私聊）。

```text
Desk 选 This Computer 或 Remote Control
  → POST /v1/runs { start: inline, deskId, repoUrls: [本机路径]
                    Remote Control 另带 target.remoteControl: true }
控制面        → 登记机器 + 对话；可见性看这条 run 的 remoteControl
Desk          → 用 run 上的路径起 worker，回合结束 release
Web / 手机    → 只见 remoteControl 的本机对话；Desk 在线则续聊派回同一台
```

常驻的是 Desk 主进程的 inbox，不是某条对话的 worker。

---

## 1. 一期做什么、不做什么

| | 做 | 不做（二期） |
| --- | --- | --- |
| Desk | composer 三项：Cloud / This Computer / Remote Control | 设置里的整机 Remote control 开关 |
| 工作区 | 记在 **run**：`deskId` + 本机路径 | 报到 desk.workspaces 清单 |
| Web / 手机 | 只看见 **Remote Control** 那条；Desk 在线可跟进 | 网页新开「派到这台电脑」 |
| Web | — | 「目标 → 本机」选机器 · 仓库 |
| 开关 | 按对话的 `remoteControl` | 打开整机开关就上报已绑文件夹 |

登录只登记**机器**。选文件夹只授权**这台电脑上的目录**。网页新开本机对话仍看 `desk.allowRemote`（本期没有入口）。

---

## 2. 两本账

| | Desk 本机小本子 | 控制面这台 desk 的账 |
| --- | --- | --- |
| 一期要有 | 文件夹路径、本机代号 `dws_local_*` | 机器在线、`deskId` |
| 一期不要有 | — | 工作区清单、服务器发的 workspace id |
| 谁用 | 本机列表、解绑、起进程时对路径 | 会话权威、把 Remote Control 跟进派回这台机器 |

`dws_local_*` 是路径哈希编的本机编号，不是控制面发的。本机干活认的是**路径**。控制面要认的是**哪台机器、哪条对话、是否远程可见**。

控制面 `resolveDeskTarget` 本来就分两岔：

- **没带代号 + inline**（人在这台 Desk 前）：放行，文件夹 Desk 自己知道。
- **带了代号**：无论谁发起，都去服务器清单里查。查不到就「这台电脑没有这个本机工作区」。

一期走第一岔。界面不得再把 `target.workspaceId` 写成 `deskWorkspaceId`。

---

## 3. 开场和续聊

### 3.1 Desk 开场（inline）

```text
POST /v1/runs
  start: "inline"
  source: "desk"
  target: { loop: "desk", tools: "desk", deskId
            // Remote Control 再加 remoteControl: true }
  repoUrls: [ "C:\\Users\\…\\测试" ]
  // 不传 deskWorkspaceId
```

响应带 assignment。主进程用调用方传入的 folder（即这条 run 的路径）spawn，再 claim。并发上限、沙箱根、`.neo` 约定仍见 [desk.md](./desk.md)。

### 3.2 同一条对话续聊

worker 一回合就退。跟进时：

1. `POST /v1/runs/:id/follow-ups`（网页只能跟进 `remoteControl` 的 run）
2. Desk 在线：`desk-start` / `startRun(folder)` / `takeAssignment`，**folder 来自 `run.repoUrls[0]`**
3. 不要用「当前选中的文件夹」补；并行时会指错盘
4. handoff 兜底若仍存在，**不要带本机代号**

assignment 上没有 `workspaceId`、也没有 `requestedBy` 时，Desk 不当成「别人派活」，接回自己开的这条。

**谁看得见：** 控制面只看这条 run 的 `executionTarget.remoteControl === true`。Desk 请求带 `?client=desk`（不要用会撞现网 CORS 的自定义头）。网页不选文件夹：它只往已有 session 加一句。

---

## 4. 和现网红字的对应

登录成功、文件夹还在，仍报「这台电脑没有这个本机工作区」，是因为开场带了 `dws_local_*`，控制面在空清单里查。不是没登录、不是目录丢了、不是「不是 git 仓库」、也不是型号没配。

lease 空 JSON、托盘缺 `icon.png` 是另一条线，本期不修。

---

## 5. 二期（本文不实施）

网页要在 Desk 在线时**新开**一条本机对话时，才需要：

- `desk.allowRemote` + 把已绑文件夹的短名 / repoKey 报上控制面（仍不含绝对路径）
- 网页「目标 → 本机」出现 `机器名 · 仓库名`
- dispatch 严格匹配工作区，对不上明确报错，不回落云端

那是另一条产品线。未到二期之前，不要为了 This Computer / Remote Control 对话去维护控制面上的工作区目录。
