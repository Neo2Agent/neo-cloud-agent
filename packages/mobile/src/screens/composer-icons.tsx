import Ionicons from "@expo/vector-icons/Ionicons";

export function MicIcon({ color }: { color: string }) {
  return <Ionicons name="mic" size={20} color={color} />;
}

export function SendIcon({ color }: { color: string }) {
  return <Ionicons name="arrow-up" size={20} color={color} />;
}

export function SettingsIcon({ color }: { color: string }) {
  return <Ionicons name="settings-outline" size={22} color={color} />;
}
