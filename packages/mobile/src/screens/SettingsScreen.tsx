import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MobileClient } from "../api/client";
import { githubAuthorizeHref } from "../cloud-settings-client";
import { IslandButton, IslandCard } from "./island";
import { Screen } from "./Screen";
import { colors } from "./theme";

type Props = {
  client: MobileClient;
  onBack: () => void;
  onLogout: () => void;
  envId: string;
  buildId: string;
  environments: Array<{ id: string; name?: string }>;
  builds: Array<{ id: string; envId?: string; status: string }>;
  onEnv: (value: string) => void;
  onBuild: (value: string) => void;
};

const GITHUB_UNLOADED = "GitHub 未加载";
const NOTIFY_DEFAULT = "做完或 PR 开好了会按这里推。";
const MCP_DEFAULT = "HTTP MCP 的 Bearer 只存在控制面。";

function asErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SettingsScreen(props: Props) {
  const [hint, setHint] = useState("");
  const [github, setGithub] = useState(GITHUB_UNLOADED);
  const [githubConnected, setGithubConnected] = useState(false);
  const [quotaTokens, setQuotaTokens] = useState("");
  const [quotaConcurrent, setQuotaConcurrent] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpBearer, setMcpBearer] = useState("");
  const [mcpHint, setMcpHint] = useState(MCP_DEFAULT);
  const [emailTo, setEmailTo] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [notifyHint, setNotifyHint] = useState(NOTIFY_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const account = await props.client.githubAccount();
        if (cancelled) return;
        setGithubConnected(account.connected);
        setGithub(
          account.connected
            ? `已绑定 @${account.login}`
            : account.oauthConfigured
              ? "未绑定 GitHub"
              : "管理员还没配置 GitHub OAuth",
        );
      } catch (error) {
        if (!cancelled) setGithub(asErrorMessage(error, "读取 GitHub 失败"));
      }
      try {
        const quota = await props.client.quota();
        if (cancelled) return;
        setQuotaTokens(quota.maxTokensMonth ? String(quota.maxTokensMonth) : "");
        setQuotaConcurrent(quota.maxConcurrentRuns ? String(quota.maxConcurrentRuns) : "");
      } catch (error) {
        if (!cancelled) setHint(asErrorMessage(error, "读取配额失败"));
      }
      try {
        const mcp = await props.client.listMcp();
        if (cancelled) return;
        if (mcp.servers?.length) {
          setMcpHint(`已保存 ${mcp.servers.map((item) => item.name).join("、")}。`);
        }
      } catch (error) {
        if (!cancelled) setMcpHint(asErrorMessage(error, MCP_DEFAULT));
      }
      try {
        const notify = await props.client.notifySettings();
        if (cancelled) return;
        setNotifyHint(notify.email?.configured ? "已配置完成邮件通知。" : NOTIFY_DEFAULT);
      } catch (error) {
        if (!cancelled) setNotifyHint(asErrorMessage(error, NOTIFY_DEFAULT));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.client]);

  return (
    <Screen>
      <View style={styles.topbar}>
        <Pressable onPress={props.onBack}><Text style={styles.back}>返回</Text></Pressable>
        <Text style={styles.title}>设置</Text>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <IslandCard>
          <Text style={styles.h}>GitHub 账号</Text>
          <Text style={styles.hint}>{github}</Text>
          {githubConnected ? (
            <IslandButton
              label="解除绑定"
              onPress={() => {
                void props.client
                  .disconnectGithub()
                  .then((saved) => {
                    setGithubConnected(false);
                    setGithub(saved.oauthConfigured ? "未绑定 GitHub" : "管理员还没配置 GitHub OAuth");
                    setHint("已解除 GitHub 绑定");
                  })
                  .catch((error) => setHint(asErrorMessage(error, "解除失败")));
              }}
            />
          ) : (
            <IslandButton
              label="绑定 GitHub"
              onPress={() => {
                void Linking.openURL(githubAuthorizeHref(props.client.url)).catch((error) => {
                  setHint(asErrorMessage(error, "打不开绑定页"));
                });
              }}
            />
          )}
        </IslandCard>
        <IslandCard>
          <Text style={styles.h}>环境与快照</Text>
          <Text style={styles.hint}>新对话用这里的环境和快照，和 Web 同一套。</Text>
          <TextInput
            value={props.envId}
            onChangeText={props.onEnv}
            placeholder="环境 id，空=默认"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          {props.environments.map((item) => (
            <Pressable key={item.id} onPress={() => props.onEnv(item.id)}>
              <Text style={styles.link}>{item.name || item.id}</Text>
            </Pressable>
          ))}
          <TextInput
            value={props.buildId}
            onChangeText={props.onBuild}
            placeholder="快照 id，空=复用，cold=冷装"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          {props.builds.filter((item) => item.status === "SUCCEEDED").map((item) => (
            <Pressable key={item.id} onPress={() => props.onBuild(item.id)}>
              <Text style={styles.link}>{item.id.slice(0, 8)}</Text>
            </Pressable>
          ))}
        </IslandCard>
        <IslandCard>
          <Text style={styles.h}>额度</Text>
          <TextInput
            value={quotaTokens}
            onChangeText={setQuotaTokens}
            keyboardType="numeric"
            placeholder="本月 token 上限"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <TextInput
            value={quotaConcurrent}
            onChangeText={setQuotaConcurrent}
            keyboardType="numeric"
            placeholder="同时跑的对话"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <IslandButton
            label="保存配额"
            onPress={() => {
              void props.client
                .saveQuota({
                  maxTokensMonth: Number(quotaTokens) || 0,
                  maxConcurrentRuns: Number(quotaConcurrent) || 0,
                })
                .then(() => setHint("配额已保存"))
                .catch((error) => setHint(error instanceof Error ? error.message : "保存配额失败"));
            }}
          />
        </IslandCard>
        <IslandCard>
          <Text style={styles.h}>MCP</Text>
          <Text style={styles.hint}>{mcpHint}</Text>
          <TextInput value={mcpName} onChangeText={setMcpName} placeholder="服务器名" placeholderTextColor={colors.muted} style={styles.input} />
          <TextInput value={mcpBearer} onChangeText={setMcpBearer} placeholder="Bearer" placeholderTextColor={colors.muted} style={styles.input} secureTextEntry />
          <IslandButton
            label="保存 MCP"
            onPress={() => {
              if (!mcpName.trim() || !mcpBearer.trim()) return;
              void props.client
                .saveMcp({ name: mcpName.trim(), bearer: mcpBearer.trim() })
                .then((saved) => {
                  setMcpBearer("");
                  setMcpHint(`已保存 ${(saved.servers ?? []).map((item) => item.name).join("、") || mcpName}。`);
                  setHint("MCP 已保存");
                })
                .catch((error) => setHint(asErrorMessage(error, "保存 MCP 失败")));
            }}
          />
        </IslandCard>
        <IslandCard>
          <Text style={styles.h}>完成通知</Text>
          <Text style={styles.hint}>{notifyHint}</Text>
          <TextInput value={emailTo} onChangeText={setEmailTo} placeholder="you@example.com" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
          <TextInput value={smtpHost} onChangeText={setSmtpHost} placeholder="smtp.example.com" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
          <TextInput value={smtpUser} onChangeText={setSmtpUser} placeholder="SMTP 用户" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
          <TextInput value={smtpPass} onChangeText={setSmtpPass} placeholder="SMTP 密码" placeholderTextColor={colors.muted} style={styles.input} secureTextEntry />
          <TextInput value={smtpFrom} onChangeText={setSmtpFrom} placeholder="发件人" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
          <IslandButton
            label="保存通知"
            onPress={() => {
              if (!emailTo.trim() || !smtpHost.trim()) return;
              void props.client
                .saveNotify({
                  emailTo: emailTo.trim(),
                  smtpHost: smtpHost.trim(),
                  smtpUser: smtpUser.trim(),
                  smtpPass: smtpPass,
                  smtpFrom: smtpFrom.trim(),
                })
                .then((saved) => {
                  setSmtpPass("");
                  setNotifyHint(saved.email?.configured ? "已配置完成邮件通知。" : NOTIFY_DEFAULT);
                  setHint("通知已保存");
                })
                .catch((error) => setHint(asErrorMessage(error, "保存通知失败")));
            }}
          />
        </IslandCard>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        <IslandCard>
          <IslandButton primary label="退出登录" onPress={props.onLogout} />
        </IslandCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  back: { width: 48, color: colors.ink },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: 20, gap: 12 },
  h: { fontSize: 15, fontWeight: "700", color: colors.ink, marginBottom: 6 },
  hint: { color: colors.muted, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.ink,
    backgroundColor: colors.paper,
    marginBottom: 8,
  },
  link: { color: colors.ink, paddingVertical: 4 },
});
