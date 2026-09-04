import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { describeAutomationSchedule, type Automation } from "@neo-cloud-agent/contracts/automation";
import { expertPickerLabel, type Expert, type ExpertTeam } from "@neo-cloud-agent/contracts/expert";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { SCHEDULE_PRESETS, type ScheduleKind } from "../automations";
import { runTitle } from "../format";
import { runRowMeta } from "../session";
import { Frame } from "./Frame";
import { IslandButton, IslandInput, IslandSwitch } from "./island";
import { colors } from "./theme";

export function AutomationsScreen(props: {
  items: Automation[];
  error: string;
  onBack: () => void;
  onCreate: (prompt: string, preset: ScheduleKind) => Promise<void>;
  onToggle: (item: Automation) => void;
  onOpenRun: (id: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<ScheduleKind>("daily_09");
  const [busy, setBusy] = useState(false);
  return (
    <Frame title="定时任务" onBack={props.onBack}>
      <Text style={styles.hint}>到点自动开一轮云端对话。</Text>
      <IslandInput value={prompt} onChangeText={setPrompt} placeholder="要做的事" multiline />
      <View style={styles.row}>
        {SCHEDULE_PRESETS.map((item) => (
          <IslandButton key={item.id} primary={item.id === preset} label={item.label} onPress={() => setPreset(item.id)} />
        ))}
      </View>
      <IslandButton
        primary
        label={busy ? "创建中…" : "新建任务"}
        disabled={busy || !prompt.trim()}
        onPress={() => {
          setBusy(true);
          void props.onCreate(prompt.trim(), preset).then(() => setPrompt("")).finally(() => setBusy(false));
        }}
      />
      {props.items.length === 0 ? <Text style={styles.empty}>还没有定时任务。</Text> : null}
      {props.items.map((item) => (
        <View key={item.id} style={styles.card}>
          <Text style={styles.cardTitle}>{item.name || item.prompt}</Text>
          <Text style={styles.hint}>{describeAutomationSchedule(item.schedule)}</Text>
          <View style={styles.row}>
            {item.lastRunId ? <IslandButton label="打开上次对话" onPress={() => props.onOpenRun(item.lastRunId!)} /> : null}
            <IslandSwitch value={item.enabled} onChange={() => props.onToggle(item)} />
          </View>
        </View>
      ))}
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
    </Frame>
  );
}

export function ExpertsScreen(props: {
  experts: Expert[];
  teams: ExpertTeam[];
  error: string;
  onBack: () => void;
  onSummon: (pick: { expertId?: string; expertTeamId?: string; name: string }) => void;
  onCreate: (name: string, description: string, persona: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [persona, setPersona] = useState("");
  const [busy, setBusy] = useState(false);
  const bundled = useMemo(() => props.experts.filter((item) => item.visibility === "bundled"), [props.experts]);
  const mine = useMemo(() => props.experts.filter((item) => item.visibility === "user"), [props.experts]);
  return (
    <Frame title="专家" onBack={props.onBack}>
      <Text style={styles.hint}>选专家后再开对话。</Text>
      <Text style={styles.section}>内置专家</Text>
      {bundled.map((item) => (
        <Pressable key={item.id} style={styles.card} onPress={() => props.onSummon({ expertId: item.id, name: item.name })}>
          <Text style={styles.cardTitle}>{expertPickerLabel(item)}</Text>
          <Text style={styles.hint}>{item.description}</Text>
        </Pressable>
      ))}
      <Text style={styles.section}>我的专家</Text>
      {mine.map((item) => (
        <Pressable key={item.id} style={styles.card} onPress={() => props.onSummon({ expertId: item.id, name: item.name })}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.hint}>{item.description}</Text>
        </Pressable>
      ))}
      {props.teams.map((item) => (
        <Pressable key={item.id} style={styles.card} onPress={() => props.onSummon({ expertTeamId: item.id, name: item.name })}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.hint}>{item.description}</Text>
        </Pressable>
      ))}
      <IslandInput value={name} onChangeText={setName} placeholder="新专家名称" />
      <IslandInput value={description} onChangeText={setDescription} placeholder="简介" />
      <IslandInput value={persona} onChangeText={setPersona} placeholder="人设" multiline />
      <IslandButton
        primary
        label={busy ? "保存中…" : "新建专家"}
        disabled={busy || !name.trim()}
        onPress={() => {
          setBusy(true);
          void props.onCreate(name.trim(), description, persona).then(() => { setName(""); setDescription(""); setPersona(""); }).finally(() => setBusy(false));
        }}
      />
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
    </Frame>
  );
}

export function ProjectsScreen(props: {
  items: Project[];
  runs: Run[];
  selectedId: string | null;
  error: string;
  onBack: () => void;
  onSelect: (id: string | null) => void;
  onCreate: (name: string, instruction: string) => Promise<void>;
  onOpenRun: (id: string) => void;
  onNewInProject: () => void;
}) {
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = props.items.find((item) => item.id === props.selectedId) ?? null;
  const projectRuns = selected ? props.runs.filter((run) => run.projectId === selected.id) : [];
  if (selected) {
    return (
      <Frame title={selected.name} onBack={() => props.onSelect(null)} action={<IslandButton primary label="新对话" onPress={props.onNewInProject} />}>
        <Text style={styles.hint}>{selected.instruction || "还没有项目指令。"}</Text>
        {projectRuns.map((run) => (
          <Pressable key={run.id} style={styles.card} onPress={() => props.onOpenRun(run.id)}>
            <Text style={styles.cardTitle}>{runTitle(run)}</Text>
            <Text style={styles.hint}>{runRowMeta(run)}</Text>
          </Pressable>
        ))}
      </Frame>
    );
  }
  return (
    <Frame title="项目" onBack={props.onBack}>
      <IslandInput value={name} onChangeText={setName} placeholder="项目名称" />
      <IslandInput value={instruction} onChangeText={setInstruction} placeholder="指令" />
      <IslandButton
        primary
        label={busy ? "创建中…" : "新建项目"}
        disabled={busy || !name.trim()}
        onPress={() => {
          setBusy(true);
          void props.onCreate(name.trim(), instruction).then(() => { setName(""); setInstruction(""); }).finally(() => setBusy(false));
        }}
      />
      {props.items.map((item) => (
        <Pressable key={item.id} style={styles.card} onPress={() => props.onSelect(item.id)}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.hint}>{item.instruction || "多人协同"}</Text>
        </Pressable>
      ))}
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
    </Frame>
  );
}

export function InviteScreen(props: {
  projectName: string;
  status: string;
  busy: boolean;
  error: string;
  onBack: () => void;
  onJoin: () => void;
}) {
  return (
    <Frame title={props.projectName || "加入项目"} onBack={props.onBack}>
      <Text style={styles.hint}>
        {props.status === "pending" ? "你已经申请过了，等管理员通过。" : "用这个链接加入项目。"}
      </Text>
      <IslandButton
        primary
        disabled={props.busy || props.status === "pending"}
        label={props.status === "pending" ? "已申请" : props.busy ? "加入中…" : "加入项目"}
        onPress={props.onJoin}
      />
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
    </Frame>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 13 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 16 },
  error: { color: colors.error },
  section: { color: colors.muted, marginTop: 8, fontWeight: "600" },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14 },
  cardTitle: { color: colors.ink, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
});
