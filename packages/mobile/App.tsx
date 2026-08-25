/**
 * Expo native entry. The phone-first Vite UI in src/ is the P0 preview
 * (`pnpm dev:mobile`). This file is the same /v1 client on React Native:
 * login, list, stream with Bearer, register Expo push tokens.
 *
 *   cd packages/mobile
 *   npx expo install expo expo-secure-store expo-notifications expo-linking react-native
 *   npx expo start
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { MobileClient } from "./src/api/client";
import { memoryCredentials } from "./src/api/credentials";
import { detectMobileSource } from "./src/api/source";
import { preview, STATUS_LABELS } from "./src/format";
import type { Run } from "@neo-cloud-agent/contracts/run";

export default function NativeApp() {
  const store = useMemo(() => memoryCredentials(), []);
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState("http://127.0.0.1:8080");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const client = useMemo(() => new MobileClient(apiUrl, token), [apiUrl, token]);

  useEffect(() => {
    if (!token) return;
    void client.listRuns().then((body) => setRuns(body.runs)).catch((item) => setError(String(item)));
  }, [client, token]);

  if (!token) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 20, gap: 12, backgroundColor: "#0b0d12" }}>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "700" }}>Neo</Text>
        <TextInput placeholder="控制面 URL" placeholderTextColor="#8b93a7" value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" style={{ color: "#fff", borderColor: "#232836", borderWidth: 1, padding: 12, borderRadius: 12 }} />
        <TextInput placeholder="账号" placeholderTextColor="#8b93a7" value={email} onChangeText={setEmail} autoCapitalize="none" style={{ color: "#fff", borderColor: "#232836", borderWidth: 1, padding: 12, borderRadius: 12 }} />
        <TextInput placeholder="密码" placeholderTextColor="#8b93a7" value={password} onChangeText={setPassword} secureTextEntry style={{ color: "#fff", borderColor: "#232836", borderWidth: 1, padding: 12, borderRadius: 12 }} />
        {error ? <Text style={{ color: "#ff6b6b" }}>{error}</Text> : null}
        <Pressable
          onPress={() => {
            void (async () => {
              try {
                const session = await new MobileClient(apiUrl, "").login(email, password);
                setToken(session.token);
                await store.setToken(session.token);
                const Notifications = await import("expo-notifications").catch(() => null);
                const tokenResponse = await Notifications?.getExpoPushTokenAsync?.();
                if (tokenResponse?.data) {
                  await new MobileClient(apiUrl, session.token).registerDevice({
                    platform: detectMobileSource(),
                    pushToken: tokenResponse.data,
                  });
                }
              } catch (item) {
                setError(item instanceof Error ? item.message : "登录失败");
              }
            })();
          }}
          style={{ backgroundColor: "#6d8bff", padding: 14, borderRadius: 12 }}
        >
          <Text style={{ textAlign: "center", fontWeight: "700" }}>登录</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (runs.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0b0d12", justifyContent: "center" }}>
        <ActivityIndicator color="#6d8bff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b0d12" }}>
      <FlatList
        data={runs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ padding: 16, borderBottomColor: "#232836", borderBottomWidth: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "600" }}>{preview(item.prompt)}</Text>
            <Text style={{ color: "#8b93a7" }}>{STATUS_LABELS[item.status] ?? item.status}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
