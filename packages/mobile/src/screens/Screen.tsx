import type { ReactNode } from "react";
import { SafeAreaView, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { statusBarInset } from "./safe-area";
import { colors } from "./theme";

export function Screen({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <SafeAreaView style={[styles.root, { paddingTop: statusBarInset }, style]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: "visible" },
});
