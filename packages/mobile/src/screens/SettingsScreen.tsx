import { Pressable, StyleSheet, Text, View } from "react-native";
import { DEFAULT_API_URL } from "../place";
import { IslandButton, IslandCard, IslandInput } from "./island";
import { Screen } from "./Screen";
import { colors } from "./theme";

type Props = {
  apiUrl: string;
  onApiUrl: (value: string) => void;
  onSaveUrl: () => void;
  onBack: () => void;
  onLogout: () => void;
};

export function SettingsScreen(props: Props) {
  return (
    <Screen>
      <View style={styles.topbar}>
        <Pressable onPress={props.onBack}><Text style={styles.back}>返回</Text></Pressable>
        <Text style={styles.title}>设置</Text>
        <View style={styles.back} />
      </View>
      <View style={styles.body}>
        <IslandCard>
          <Text style={styles.label}>控制面地址</Text>
          <IslandInput value={props.apiUrl} onChangeText={props.onApiUrl} onBlur={props.onSaveUrl} autoCapitalize="none" placeholder={DEFAULT_API_URL} />
          <Text style={styles.hint}>真机默认 {DEFAULT_API_URL}。局域网填电脑 http://IP:8080。</Text>
          <View style={styles.gap} />
          <IslandButton primary label="退出登录" onPress={props.onLogout} />
        </IslandCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  back: { width: 48, color: colors.ink },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: 20 },
  label: { color: colors.ink, fontWeight: "600", marginBottom: 8 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 8 },
  gap: { height: 16 },
});
