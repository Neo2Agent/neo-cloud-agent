# 工作区持久化与磁盘回收

对照现网代码和 4C/4G/40G 轻量机，不是「每条对话一块永不擦的盘」。

槽（loop ext4）是**执行缓存**。卸槽会 `wipeMount`。用户聊出来的文件要活过释放，权威副本必须先落到宿主机 `hostRunsDir/<runId>`（默认 `RUNS_DIR/<runId>`）。对话 / transcript / pi session 本来就不在槽上，见 [desk-project-design.md 附录 A](./desk-project-design.md#a2-对话-jsonl-除了工作区还有没有持久化)。

## 1. 目标

1. **卸槽不丢用户文件。** 空闲释放或归档前必须把槽上的工作区写回 host。写回失败则**拒绝卸槽**（归档除外：用户明确结束，尽量写回，失败也释放计算）。
2. **跟进能从 host 灌回槽。** `provision` 只从 `hostRunsDir/<runId>` 恢复，不再误读另一条路径。
3. **40G 盘撑得住。** 不把 `node_modules` / `dist` 等缓存当持久化对象；全站有预算；过期和超预算的工作区按 LRU 回收。回收**只删工作区树**，不删 `.control` 对话。

## 2. 三层寿命

| 层 | 位置 | 卸槽后 | 工作区回收后 |
| --- | --- | --- | --- |
| 对话 / 事件 / transcript | `.control/<runId>.*` + 对象存储 + MySQL | 在 | 在 |
| pi session 备份 | `.control/<runId>.session/` | 在 | 在 |
| 工作区文件 | 热数据在槽上；权威在 `hostRunsDir/<runId>` | 在（写回成功） | 没了；聊天还在 |

槽限制的是同时挂着的执行面（现网 2 个），不是同时存在的对话数。

## 3. 写回与恢复

```
IDLE ≥ WORKER_IDLE_RELEASE_MS
        │
        ▼
persistDurableWorkspace(slot → hostRunsDir/<runId>)
        │ 失败 → 留下槽，发 workspace.persist_failed
        ▼
reclaim（先腾预算）
        │
        ▼
shutdown worker → umount → 槽 idle
```

下一任占同一槽：`wipeMount` → 把 **这一条 Run** 的 host 目录拷进新槽。

写回过滤器（`skipDurablePersist`）跳过：

`lost+found`、`node_modules`、`dist`、`.pnpm-store`、`.builds`、`.warm`、`.firecracker`

源文件、`.git`、`.neo`（含 inbox 图）、用户新建文件都拷。写回是镜像：host 上多出来的旧文件和缓存目录会删掉，避免 stale。

`local` 运行时 src === dest，没有槽，文件已经在 host 上，只刷新元数据。

元数据：`RUNS_DIR/.control/<runId>.workspace.json`

```json
{
  "version": 1,
  "state": "present",
  "bytes": 184320,
  "persistedAt": "2026-08-26T12:00:00.000Z"
}
```

回收后 `state` 为 `evicted`，带 `evictedAt` / `evictedReason`（`budget` | `ttl`）。

## 4. 磁盘上限（按 40G 现网）

现网盘大约：

| 占用 | 约 |
| --- | --- |
| 系统 + Node + 仓库 | 8–12G |
| 2×4GiB loop 槽镜像 | 最多 8G（稀疏） |
| `.objects` / builds | 数 G |
| **持久化工作区预算** | **默认 12G** |
| 余量 | 留给日志和尖峰 |

环境变量（`0` = 该项不限制 / 关闭）：

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `WORKSPACE_STORE_MAX_MIB` | `vm` 为 `12288`，其它 `0` | 所有 `hostRunsDir/<runId>` 合计上限 |
| `WORKSPACE_PERSIST_MAX_MIB` | `1024` | 单 Run 软上限；超了仍写回（不丢用户文件），空闲时优先被回收 |
| `WORKSPACE_IDLE_TTL_MS` | `7d` | IDLE / ERROR 工作区超过此时长也可回收 |
| `WORKSPACE_ARCHIVED_TTL_MS` | `3d` | ARCHIVED / EXPIRED 工作区超过此时长也可回收 |
| `WORKSPACE_RECLAIM` | `1` | `0` 关闭回收（单测） |
| `WORKSPACE_RECLAIM_INTERVAL_MS` | `60000` | 周期扫描 |

单 Run 软上限不是截断写回。某条对话写了 2GiB 视频，仍然落盘；预算不够就先回收别人。写回因 ENOSPC 失败则留下槽。

## 5. 回收

保护（永不回收）：

- 状态在 `NOT_YET_STARTED` / `PROVISIONING` / `INSTALLING` / `RUNNING` / `WAITING_FOR_BACKGROUND_WORK`
- 还挂着 worker handle 或 VM 槽
- 正在写回的那一条（`exceptRunId`）

候选按档：`EXPIRED` → `ARCHIVED` → `ERROR` → `IDLE`。档内按 `updatedAt` 最老先删；同档超软上限的优先。host 上有目录但内存里没有 Run 的，当孤儿，最先删。

两趟：

1. **TTL**：超过对应 TTL 的未保护工作区删掉（防止慢漏）。
2. **预算**：TTL 之后合计仍大于 `WORKSPACE_STORE_MAX_MIB`，按上面的档继续删，直到低于上限或没有可删的。

回收动作：删除 `hostRunsDir/<runId>` 下的文件，写 `evicted` 元数据，发 `workspace.reclaimed`。不改 Run 状态，不删 transcript。

跟进一条已被回收的对话：session 备份仍还原；若有 `repoUrls` 则再 clone 一份仓库（没有用户未提交改动）；文件树提示工作区已回收。

## 6. 和旧实现的差别

| 旧 | 现 |
| --- | --- |
| `persistRunWorkspace` 找不到槽就 `return false`，异常只打日志，照样卸槽 | 空闲释放：写回失败则留下槽 |
| 写回整树（含 `node_modules`），40G 很快满 | 跳过缓存 |
| 恢复用 `copyWorkspaceTree(hostWorkspaceDir)`，`HOST_RUNS_DIR` ≠ `RUNS_DIR` 时读错目录 | 只从 `hostWorkspaceBind` / `hostRunsDir/<runId>` 恢复 |
| 没有全站预算 | 12G + TTL + LRU |
| 文件树卸槽后读 `workspaceFor`；写回失败就只剩第一次 clone | 写回成功则读 host 权威副本 |

## 7. 不做

- 不为每条 Run 挂一块不回收的 ext4（现网只有 2 个槽）。
- 不把整树推进对象存储 / S3（现网对象库仍是本机 `.objects`）。
- 回收不删对话。要清对话走归档保留策略（另一条线）。
- 不在第一期做「超单 Run 软上限就截断用户文件」。
