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
  btn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: colors.accent },
  ghost: { backgroundColor: colors.paper },
  disabled: { opacity: 0.4 },
  primaryText: { color: colors.cream, fontWeight: "700" },
  ghostText: { color: colors.ink, fontWeight: "700" },
  input: {
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
});
