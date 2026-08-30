import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IslandButton, IslandCard, IslandInput } from "./island";
import { Screen } from "./Screen";
import { colors } from "./theme";

type Props = {
  busy: boolean;
  error: string;
  email: string;
  username: string;
  phone: string;
  password: string;
  onEmail: (value: string) => void;
  onUsername: (value: string) => void;
  onPhone: (value: string) => void;
  onPassword: (value: string) => void;
  onLogin: () => void;
  onRegister: () => void;
};

export function LoginScreen(props: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const registering = mode === "register";
  return (
    <Screen style={styles.page}>
      <IslandCard>
        <Text style={styles.title}>Neo</Text>
        <Text style={styles.lead}>{registering ? "手机号注册，无需验证码" : "用户名或手机号登录"}</Text>
        {registering ? (
          <>
            <IslandInput value={props.username} onChangeText={props.onUsername} autoCapitalize="none" placeholder="用户名" />
            <View style={styles.gap} />
            <IslandInput
              value={props.phone}
              onChangeText={props.onPhone}
              autoCapitalize="none"
              keyboardType="phone-pad"
              placeholder="手机号"
            />
          </>
        ) : (
          <IslandInput value={props.email} onChangeText={props.onEmail} autoCapitalize="none" placeholder="用户名或手机号" />
        )}
        <View style={styles.gap} />
        <IslandInput value={props.password} onChangeText={props.onPassword} secureTextEntry placeholder="密码" />
        {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
        <View style={styles.gap} />
        <IslandButton
          primary
          disabled={props.busy}
          label={props.busy ? (registering ? "注册中…" : "登录中…") : registering ? "注册并登录" : "Continue"}
          onPress={registering ? props.onRegister : props.onLogin}
        />
        <Pressable onPress={() => setMode(registering ? "login" : "register")}>
          <Text style={styles.switch}>{registering ? "已有账号？去登录" : "没有账号？手机号注册"}</Text>
        </Pressable>
      </IslandCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { justifyContent: "center", padding: 24 },
  title: { fontSize: 32, fontWeight: "800", color: colors.accent, marginBottom: 8 },
  lead: { color: colors.muted, marginBottom: 16 },
  gap: { height: 10 },
  error: { color: colors.error, marginTop: 8 },
  switch: { color: colors.accent, marginTop: 14, textAlign: "center" },
});
