# Neo Mobile

Expo 壳 + 同一套 `/v1`。视觉对齐 Desk 动森纸卡（茶色墨 / 青绿按钮）。新开只发云端；列表能看到 Desk Remote，看不到 This Computer。抽屉里有定时任务、项目、专家。

## 两轨开发

**视觉实验室（浏览器）**

```bash
pnpm dev:mobile
```

打开 `http://127.0.0.1:5175`。空控制面地址走 Vite 代理到本机 `:8080`。

**真机壳（Expo Go）**

第一次先在本目录装 Expo 运行时（不要从仓库根 `pnpm install` 重算整个 lockfile；Desk 的 electron-builder 会去拉 git 依赖）：

```bash
cd packages/mobile
npx expo install expo expo-secure-store expo-notifications expo-linking expo-status-bar react-native
pnpm start
```

用 Expo Go 扫码。默认 API 是 `http://62.234.211.200`。

连本机控制面时，登录页把地址改成电脑的局域网 IP，例如 `http://192.168.1.8:8080`。手机和电脑要在同一 Wi-Fi；`app.json` 已允许本机明文 HTTP。不要用 `127.0.0.1`（那是手机自己）。

登录后会 `POST /v1/devices` 登记推送。点通知或打开 `neo://runs/<id>` 会回到该对话。前台已经在订 SSE 时不重复弹本地横幅。
