import { StyleSheet, Text, View } from "react-native";
import { dayGreeting } from "../island-theme";
import { colors } from "./theme";

export function HomeScreen({ expertName }: { expertName?: string }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.hello}>{dayGreeting()}，今天想做点什么</Text>
      <Text style={styles.hint}>{expertName ? `已选专家 ${expertName}` : "新开一条云端对话，或从左边打开已有任务。"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hello: { fontSize: 22, fontWeight: "700", color: colors.ink, textAlign: "center" },
  hint: { color: colors.muted, marginTop: 8, textAlign: "center" },
});
