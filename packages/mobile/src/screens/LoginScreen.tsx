import { Pressable, StyleSheet, Text, View } from "react-native";
import { IslandButton, IslandCard, IslandInput } from "./island";
import { Screen } from "./Screen";
import { colors } from "./theme";

type Props = {
  busy: boolean;
  error: string;
  email: string;
  password: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: () => void;
};

export function LoginScreen(props: Props) {
  return (
    <Screen style={styles.page}>
      <IslandCard>
        <Text style={styles.title}>Neo</Text>
        <Text style={styles.lead}>欢迎回来</Text>
        <IslandInput value={props.email} onChangeText={props.onEmail} autoCapitalize="none" placeholder="账号" />
        <View style={styles.gap} />
        <IslandInput value={props.password} onChangeText={props.onPassword} secureTextEntry placeholder="密码" />
        {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
        <View style={styles.gap} />
        <IslandButton primary disabled={props.busy} label={props.busy ? "登录中…" : "Continue"} onPress={props.onSubmit} />
      </IslandCard>
      <Pressable />
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { justifyContent: "center", padding: 24 },
  title: { fontSize: 32, fontWeight: "800", color: colors.accent, marginBottom: 8 },
  lead: { color: colors.muted, marginBottom: 16 },
  gap: { height: 10 },
  error: { color: colors.error, marginTop: 8 },
});
