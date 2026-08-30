import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CHAT_MODELS, chatModelLabel, resolveChatModel } from "../format";
import type { StartVoiceResult } from "../speech-cloud";
import { finishHoldVoice, isVoiceHoldTap, mergeSpokenText } from "../voice";
import { MicIcon, SendIcon } from "./composer-icons";
import { colors } from "./theme";

type Props = {
  prompt: string;
  locked: boolean;
  placeholder: string;
  sending: boolean;
  canStop: boolean;
  model: string;
  onModel: (value: string) => void;
  onPrompt: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  startVoice: (
    onPreview: (text: string) => void,
    onError?: (message: string) => void,
    onEnded?: () => void,
  ) => Promise<StartVoiceResult>;
};

export function Composer(props: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const fieldRef = useRef<TextInput>(null);
  const voiceRef = useRef<{ stop: () => Promise<string> } | null>(null);
  const basePrompt = useRef(props.prompt);
  const promptRef = useRef(props.prompt);
  const holdStarted = useRef(0);
  const holdArmed = useRef(false);
  promptRef.current = props.prompt;
  const canSend = !props.locked && !props.sending && Boolean(props.prompt.trim());
  const selected = resolveChatModel(props.model);

  useEffect(() => () => {
    void voiceRef.current?.stop();
  }, []);

  const applyHoldResult = (heldMs: number, spoken: string) => {
    const kept = finishHoldVoice({ heldMs, spoken });
    if (kept) {
      const next = mergeSpokenText(basePrompt.current, kept);
      if (next !== promptRef.current) props.onPrompt(next);
      return;
    }
    if (isVoiceHoldTap(heldMs)) {
      props.onPrompt(basePrompt.current);
      fieldRef.current?.focus();
    }
  };

  const beginHold = async () => {
    if (props.locked || props.sending || holdArmed.current) return;
    holdArmed.current = true;
    holdStarted.current = Date.now();
    const startedAt = holdStarted.current;
    setMenuOpen(false);
    basePrompt.current = promptRef.current;
    const started = await props.startVoice(
      (text) => props.onPrompt(mergeSpokenText(basePrompt.current, text)),
      (message) => {
        setListening(false);
        voiceRef.current = null;
        Alert.alert("语音没出字", message);
      },
      () => {
        setListening(false);
        voiceRef.current = null;
      },
    );
    if (started.kind !== "session") {
      holdArmed.current = false;
      holdStarted.current = 0;
      Alert.alert("无法开始语音输入", started.message);
      return;
    }
    if (!holdStarted.current) {
      const spoken = await started.session.stop();
      applyHoldResult(Date.now() - startedAt, spoken);
      return;
    }
    voiceRef.current = started.session;
    setListening(true);
  };

  const endHold = async () => {
    if (!holdArmed.current && !voiceRef.current) return;
    holdArmed.current = false;
    const heldMs = holdStarted.current ? Date.now() - holdStarted.current : 0;
    holdStarted.current = 0;
    const session = voiceRef.current;
    voiceRef.current = null;
    setListening(false);
    const spoken = session ? await session.stop() : "";
    applyHoldResult(heldMs, spoken);
  };

  return (
    <View style={styles.dock}>
      <View style={styles.bar}>
        <TextInput
          ref={fieldRef}
          value={props.prompt}
          onChangeText={props.onPrompt}
          onFocus={() => setMenuOpen(false)}
          editable={!props.locked}
          placeholder={listening ? "松手出字" : props.placeholder}
          placeholderTextColor={colors.muted}
          multiline
          style={styles.field}
        />
        <View style={styles.tools}>
          <View style={styles.modelWrap}>
            {menuOpen ? (
              <View style={styles.modelMenu} accessibilityRole="menu">
                {CHAT_MODELS.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      props.onModel(item.id);
                      setMenuOpen(false);
                    }}
                    style={[styles.option, item.id === selected ? styles.optionOn : null]}
                    accessibilityRole="menuitem"
                  >
                    <Text style={styles.model}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable onPress={() => setMenuOpen((open) => !open)} style={styles.modelChip} accessibilityLabel="选择模型">
              <Text style={styles.model}>{chatModelLabel(props.model)} ▴</Text>
            </Pressable>
          </View>
          <View style={styles.sendGroup}>
            <Pressable
              disabled={props.locked || props.sending}
              onPressIn={() => void beginHold()}
              onPressOut={() => void endHold()}
              style={[styles.mic, listening ? styles.micOn : null]}
              accessibilityLabel={listening ? "松手出字" : "按住说话"}
            >
              <MicIcon color={listening ? colors.cream : props.locked || props.sending ? colors.muted : colors.ink} />
            </Pressable>
            <Pressable
              disabled={!props.canStop && !canSend}
              onPress={props.canStop ? props.onStop : props.onSend}
              style={[styles.send, props.canStop ? styles.sendStop : !canSend ? styles.sendOff : null]}
              accessibilityLabel={props.canStop ? "停止" : "发送"}
            >
              {props.canStop ? (
                <View style={styles.stopIcon} />
              ) : (
                <SendIcon color={canSend ? colors.cream : colors.muted} />
              )}
            </Pressable>
          </View>
        </View>
      </View>
      <Text style={styles.legal}>内容由 AI 生成</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8, backgroundColor: colors.bg, overflow: "visible", zIndex: 2 },
  bar: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 2,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
    overflow: "visible",
    zIndex: 2,
  },
  field: { minHeight: 52, maxHeight: 140, color: colors.ink, padding: 0, textAlignVertical: "top" },
  tools: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8, zIndex: 3 },
  modelWrap: { position: "relative", zIndex: 4 },
  modelMenu: {
    position: "absolute",
    left: 0,
    bottom: "100%",
    marginBottom: 6,
    minWidth: 168,
    padding: 4,
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 2,
    borderRadius: 14,
    elevation: 6,
  },
  modelChip: { backgroundColor: "#d7f6f2", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  model: { color: colors.ink, fontWeight: "700", fontSize: 13 },
  option: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  optionOn: { backgroundColor: "#d7f6f2" },
  sendGroup: { flexDirection: "row", alignItems: "center", gap: 8 },
  mic: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  micOn: { backgroundColor: colors.accent },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendStop: { backgroundColor: colors.error },
  sendOff: { backgroundColor: "#e6efe8" },
  stopIcon: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.cream },
  legal: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 8 },
});
