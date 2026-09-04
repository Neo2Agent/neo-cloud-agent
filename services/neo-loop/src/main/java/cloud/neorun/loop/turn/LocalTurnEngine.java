package cloud.neorun.loop.turn;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Component;
import cloud.neorun.loop.agent.AgentEventMapper;
import cloud.neorun.loop.agent.NeoHarnessFactory;
import cloud.neorun.loop.cloud.ControlPlaneClient;
import cloud.neorun.loop.config.LoopProperties;
import cloud.neorun.loop.sandbox.NeoSandbox;
import cloud.neorun.loop.sandbox.ToolsHub;
import cloud.neorun.loop.store.FileAgentStateStore;
import cloud.neorun.loop.store.FileStepLog;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.harness.agent.HarnessAgent;
import reactor.core.publisher.Flux;

@Component
public class LocalTurnEngine implements TurnWorkflowEngine {
  private final ToolsHub toolsHub;
  private final LoopProperties properties;
  private final FileStepLog stepLog;
  private final FileAgentStateStore sessions;
  private final ExecutorService workers = Executors.newCachedThreadPool();
  private final ConcurrentHashMap<String, LiveTurn> live = new ConcurrentHashMap<>();

  private record LiveTurn(
      StartTurnCommand cmd,
      AtomicBoolean aborted,
      String steerText,
      String phase,
      Instant startedAt) {}

  public LocalTurnEngine(ToolsHub toolsHub, LoopProperties properties) {
    this.toolsHub = toolsHub;
    this.properties = properties;
    var root = properties.resolveStateDir();
    this.stepLog = new FileStepLog(root);
    this.sessions = new FileAgentStateStore(root);
  }

  @Override
  public TurnHandle start(StartTurnCommand cmd) {
    live.put(
        cmd.turnId(),
        new LiveTurn(cmd, new AtomicBoolean(false), null, "ensure", Instant.now()));
    workers.execute(() -> runTurn(cmd));
    return new TurnHandle(cmd.turnId(), cmd.runId(), true);
  }

  @Override
  public void signal(String turnId, TurnSignal signal) {
    LiveTurn current = live.get(turnId);
    if (current == null) {
      throw new IllegalStateException("unknown turn " + turnId);
    }
    if (signal.abort()) {
      current.aborted.set(true);
      toolsHub.abortAll(current.cmd.runId());
      return;
    }
    if (signal.steer()) {
      live.put(
          turnId,
          new LiveTurn(current.cmd, current.aborted, signal.text(), current.phase, current.startedAt));
      toolsHub.abortAll(current.cmd.runId());
    }
  }

  @Override
  public TurnSnapshot query(String turnId) {
    LiveTurn current = live.get(turnId);
    if (current == null) {
      return new TurnSnapshot(turnId, "", "done", "", Instant.now().toString());
    }
    return new TurnSnapshot(
        turnId, current.cmd.runId(), current.phase, "", current.startedAt.toString());
  }

  private void runTurn(StartTurnCommand cmd) {
    ControlPlaneClient cloud = new ControlPlaneClient(cmd.controlPlaneUrl(), cmd.jwt());
    EmitEventsActivity emit = new EmitEventsActivity(cloud, cmd.runId(), cmd.turnId());
    AgentEventMapper mapper = new AgentEventMapper(emit, cmd.turnId());
    int step = 0;
    try {
      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "ensure", "started", cmd.text(), "");
      cloud.heartbeat(cmd.runId(), cmd.turnId(), "ensure", "wait-tools");
      updatePhase(cmd.turnId(), "ensure");
      if (cmd.tools() == null || !"skip".equals(cmd.tools().mode())) {
        toolsHub.awaitReady(cmd.runId(), Duration.ofMillis(Math.max(1_000, properties.getToolsWaitMs())));
      }
      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "ensure", "done", "", "ready");

      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "restore", "started", "", "");
      updatePhase(cmd.turnId(), "restore");
      Map<String, Object> session = sessions.load(cmd.runId());
      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "restore", "done", "", "");

      mapper.agentStart();
      String userText = cmd.text();
      LiveTurn liveTurn = live.get(cmd.turnId());
      if (liveTurn != null && liveTurn.steerText != null && !liveTurn.steerText.isBlank()) {
        userText = "停止原计划，改做：" + liveTurn.steerText + "\n\n原始任务：\n" + cmd.text();
      }

      boolean usedHarness = false;
      if (!"react".equalsIgnoreCase(properties.getEngine())) {
        usedHarness = runHarness(cmd, cloud, mapper, userText);
      }
      if (!usedHarness) {
        runActivityLoop(cmd, cloud, emit, mapper, userText);
      }

      if (liveTurn != null && liveTurn.aborted.get()) {
        cloud.complete(cmd.runId(), cmd.turnId(), "idle", "cancelled", true);
        return;
      }

      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "persist", "started", "", "");
      updatePhase(cmd.turnId(), "persist");
      session.put("lastTurnId", cmd.turnId());
      session.put("lastDelivery", cmd.delivery());
      sessions.save(cmd.runId(), session);
      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "persist", "done", "", "");
      updatePhase(cmd.turnId(), "done");
      cloud.complete(cmd.runId(), cmd.turnId(), "idle", null, false);
    } catch (Exception error) {
      try {
        mapper.error(error.getMessage());
      } catch (RuntimeException ignored) {
        // best-effort; turn-complete is the source of truth
      }
      try {
        cloud.complete(cmd.runId(), cmd.turnId(), "error", error.getMessage(), false);
      } catch (RuntimeException ignored) {
        // caller will time out if complete never lands
      }
    } finally {
      live.remove(cmd.turnId());
    }
  }

  private boolean runHarness(StartTurnCommand cmd, ControlPlaneClient cloud, AgentEventMapper mapper, String userText) {
    NeoSandbox sandbox = new NeoSandbox(toolsHub, cmd.runId(), cmd.tools() == null ? "/workspace" : cmd.tools().sandboxRoot());
    NeoHarnessFactory.BuiltAgent built = new NeoHarnessFactory().create(cmd, sandbox, cloud);
    HarnessAgent harness = built.harness();
    ReActAgent agent = built.react();
    RuntimeContext ctx = RuntimeContext.builder().userId(cmd.userId()).sessionId(cmd.runId()).build();
    Flux<?> stream = harness != null ? harness.streamEvents(userText, ctx) : agent.streamEvents(userText, ctx);
    stream.doOnNext(event -> {
          if (event instanceof io.agentscope.core.event.AgentEvent agentEvent) {
            mapper.accept(agentEvent);
          }
        })
        .blockLast();
    return true;
  }

  private void runActivityLoop(
      StartTurnCommand cmd,
      ControlPlaneClient cloud,
      EmitEventsActivity emit,
      AgentEventMapper mapper,
      String userText) {
    InferActivity infer = new InferActivity();
    ToolActivity tools = new ToolActivity();
    NeoSandbox sandbox = new NeoSandbox(toolsHub, cmd.runId(), cmd.tools() == null ? "/workspace" : cmd.tools().sandboxRoot());
    List<Map<String, Object>> messages = new ArrayList<>();
    messages.add(Map.of("role", "system", "content", NeoHarnessFactory.systemPrompt(cmd)));
    messages.add(Map.of("role", "user", "content", userText));
    List<Map<String, Object>> toolSchemas = defaultTools();
    boolean visible = false;
    for (int hop = 0; hop < 12; hop++) {
      LiveTurn liveTurn = live.get(cmd.turnId());
      if (liveTurn != null && liveTurn.aborted.get()) {
        return;
      }
      if (liveTurn != null && liveTurn.steerText != null && hop > 0) {
        messages.add(Map.of("role", "user", "content", "停止原计划，改做：" + liveTurn.steerText));
        live.put(
            cmd.turnId(),
            new LiveTurn(liveTurn.cmd, liveTurn.aborted, null, "infer", liveTurn.startedAt));
      }
      updatePhase(cmd.turnId(), "infer");
      stepLog.append(cmd.runId(), cmd.turnId(), hop * 2 + 10, "infer_started", "started", userText, "");
      InferActivity.InferResult result = infer.run(cmd.llmGatewayUrl(), cmd.jwt(), cmd.model(), messages, toolSchemas);
      stepLog.append(cmd.runId(), cmd.turnId(), hop * 2 + 11, "infer_done", "done", "", result.raw());
      mapper.usage(result.promptTokens(), result.completionTokens());
      if (result.content() != null && !result.content().isBlank()) {
        mapper.textDelta(result.content());
        mapper.textEnd();
        visible = true;
        messages.add(Map.of("role", "assistant", "content", result.content()));
      }
      if (result.toolCalls().isEmpty()) {
        if (!visible) {
          mapper.emptyTurn();
        }
        return;
      }
      List<Map<String, Object>> toolMessages = new ArrayList<>();
      Map<String, Object> assistant = new LinkedHashMap<>();
      assistant.put("role", "assistant");
      assistant.put("content", result.content() == null ? "" : result.content());
      List<Map<String, Object>> encodedCalls = new ArrayList<>();
      for (InferActivity.ToolCall call : result.toolCalls()) {
        encodedCalls.add(
            Map.of(
                "id",
                call.id(),
                "type",
                "function",
                "function",
                Map.of("name", call.name(), "arguments", call.arguments())));
      }
      assistant.put("tool_calls", encodedCalls);
      messages.add(assistant);
      for (InferActivity.ToolCall call : result.toolCalls()) {
        updatePhase(cmd.turnId(), "tool");
        mapper.toolStart(call.name(), call.id(), call.arguments());
        String output = tools.run(call.name(), call.arguments(), sandbox, cloud, cmd.runId());
        mapper.toolEnd(call.name(), call.id(), output, output.startsWith("tool error"));
        visible = true;
        toolMessages.add(Map.of("role", "tool", "tool_call_id", call.id(), "content", output));
      }
      messages.addAll(toolMessages);
    }
  }

  private void updatePhase(String turnId, String phase) {
    LiveTurn current = live.get(turnId);
    if (current != null) {
      live.put(turnId, new LiveTurn(current.cmd, current.aborted, current.steerText, phase, current.startedAt));
    }
  }

  private static List<Map<String, Object>> defaultTools() {
    return List.of(
        function("execute", "Run a POSIX shell command", Map.of("command", Map.of("type", "string"), "timeoutMs", Map.of("type", "integer")), List.of("command")),
        function("read_file", "Read a workspace file", Map.of("path", Map.of("type", "string")), List.of("path")),
        function("write_file", "Write a workspace file", Map.of("path", Map.of("type", "string"), "content", Map.of("type", "string")), List.of("path", "content")),
        function("edit_file", "Edit a workspace file", Map.of("path", Map.of("type", "string"), "old_string", Map.of("type", "string"), "new_string", Map.of("type", "string")), List.of("path", "old_string", "new_string")));
  }

  private static Map<String, Object> function(String name, String description, Map<String, Object> properties, List<String> required) {
    return Map.of(
        "type",
        "function",
        "function",
        Map.of(
            "name",
            name,
            "description",
            description,
            "parameters",
            Map.of("type", "object", "properties", properties, "required", required)));
  }
}
