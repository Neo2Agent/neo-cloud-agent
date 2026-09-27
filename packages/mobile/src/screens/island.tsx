import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors } from "./theme";

export function IslandButton(props: { label: string; primary?: boolean; disabled?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.btn, props.primary ? styles.primary : styles.ghost, props.disabled ? styles.disabled : null]}
    >
      <Text style={props.primary ? styles.primaryText : styles.ghostText}>{props.label}</Text>
    </Pressable>
  );
}

export function IslandInput(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />;
}

export function IslandCard(props: { children: ReactNode }) {
  return <View style={styles.card}>{props.children}</View>;
}

export function IslandSwitch(props: { value: boolean; onChange: () => void }) {
  return <Switch value={props.value} onValueChange={props.onChange} trackColor={{ true: colors.accent }} />;
}

const styles = StyleSheet.create({
  btn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: colors.accent },
  ghost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  disabled: { opacity: 0.4 },
  primaryText: { color: "#ffffff", fontWeight: "600" },
  ghostText: { color: colors.ink, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
});
