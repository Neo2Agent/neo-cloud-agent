import { Pressable, StyleSheet, Text, View } from "react-native";
import { IslandButton, IslandCard } from "./island";
import { Screen } from "./Screen";
import { colors } from "./theme";

type Props = {
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
});
