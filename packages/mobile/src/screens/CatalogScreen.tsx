import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Screen } from "./Screen";
import { colors } from "./theme";

type Item = { id: string; label: string; hint?: string };

type Props = {
  title: string;
  empty: string;
  items: Item[];
  onBack: () => void;
  onPick: (id: string) => void;
};

export function CatalogScreen(props: Props) {
  return (
    <Screen>
      <View style={styles.topbar}>
        <Pressable onPress={props.onBack}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.title}>{props.title}</Text>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {props.items.length === 0 ? <Text style={styles.empty}>{props.empty}</Text> : null}
        {props.items.map((item) => (
          <Pressable key={item.id} onPress={() => props.onPick(item.id)} style={styles.row}>
            <Text style={styles.label}>{item.label}</Text>
            {item.hint ? <Text style={styles.hint}>{item.hint}</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  back: { width: 48, color: colors.ink },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  list: { padding: 16, gap: 8 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 24 },
  row: {
    backgroundColor: colors.paper,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  label: { color: colors.ink, fontWeight: "600" },
  hint: { color: colors.muted, marginTop: 4, fontSize: 13 },
});
