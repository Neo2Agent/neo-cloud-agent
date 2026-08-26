export const CLI_VERSION = "0.1.0";

export const HELP_TEXT = `neo — Neo Cloud Agent 的终端客户端

用法:
  neo [flags] <command>
  neo [flags] --repo <url> [-p] "<prompt>"

这是控制面 /v1 的客户端，不在本机跑 Agent loop。
设计见 docs/cli.md。

命令:
  login                 保存账号 session 或服务令牌
  logout                删除本机凭证
  whoami                当前身份
  health                控制面健康检查
  run                   创建 Run 并等待本轮结束
  follow <id>           给已有 Run 发跟进
  resume <id>           续看已有 Run（IDLE 则打印 transcript）
  ls                    列出 Run
  get <id>              查看 Run 元数据
  log <id>              打印 transcript（--follow 跟直播）
  abort <id>            中止
  archive <id>          归档并释放槽位
  diff <id>             工作区 diff
  diag <id>             setup / egress / 环境诊断
  pr <id>               开草稿 PR
  commit <id> -m msg    受控 commit
  env ls                环境列表
  build ls              Build 列表
  vms                   VM 槽位

常用旗标:
  --url                 控制面地址（默认 http://127.0.0.1:8080）
  --api-key             服务令牌或 session
  -p, --print           非交互等待（P0 默认就是等待）
  --detach, --no-wait   只创建 / 投递，不等待
  --repo <url>          可重复；相对路径按控制面根目录解析
  --dir <path>          本机目录，会展开成绝对路径
  --env / --build       环境或快照
  --model               模型 id
  --output-format       text | json | stream-json
  --timeout             10m / 120s / 毫秒
  -h, --help

环境变量:
  NEO_API_URL           控制面
  NEO_API_KEY           令牌（也认 NEO_TOKEN / CONTROL_PLANE_TOKEN）
  NEO_CONFIG_DIR        覆盖 ~/.config/neo
`;

export function commandHelp(command: string): string {
  switch (command) {
    case "login":
      return `neo login [--email] [--password] [--token]
  --token     写入服务令牌（CI）
  --email     账号登录
密码可用 --password 或 NEO_PASSWORD；TTY 下会提示。`;
    case "run":
      return `neo run [prompt…] --repo <url> [--env] [--build] [--model] [--expert] [--expert-team]
  --detach    打印 run id 后退出
  --timeout   等待上限，默认 10m
  --expert    专家 id 或 slug，例如 reviewer
  --expert-team 专家团 id 或 slug，例如 ship-change
没有子命令时，剩余参数也当作 run 的 prompt。`;
    case "follow":
      return `neo follow <runId> [text…] [--delivery prompt|steer|follow_up]`;
    case "log":
      return `neo log <runId> [--follow]`;
    default:
      return HELP_TEXT;
  }
}
