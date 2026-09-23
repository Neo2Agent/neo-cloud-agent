package cloud.neorun.loop.turn;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import cloud.neorun.loop.agent.AgentEventMapper;
import cloud.neorun.loop.agent.NeoHarnessFactory;
import cloud.neorun.loop.cloud.ControlPlaneClient;
import cloud.neorun.loop.config.LoopProperties;
import cloud.neorun.loop.sandbox.NeoSandbox;
import cloud.neorun.loop.sandbox.ToolsHub;
import cloud.neorun.loop.store.FileAgentStateStore;
import cloud.neorun.loop.store.FileStepLog;
import cloud.neorun.loop.store.SessionRestore;
import cloud.neorun.loop.support.LinkedMaps;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.AgentEvent;
import io.agentscope.harness.agent.HarnessAgent;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import reactor.core.publisher.Flux;

/**
 * Single-host turn engine: runs each turn on a worker thread, journals every step to
 * {@link FileStepLog}, and resumes unfinished turns on startup.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
@Component
public class LocalTurnEngine implements TurnWorkflowEngine {
  private static final Logger LOG = LoggerFactory.getLogger(LocalTurnEngine.class);

  /** A loop host serves a handful of VM slots; extra turns queue instead of spawning threads. */
  private static final int TURN_THREADS = 8;
  private static final int TURN_QUEUE_CAPACITY = 64;
  private static final long TURN_THREAD_KEEP_ALIVE_SECONDS = 60L;
  private static final long SHUTDOWN_WAIT_SECONDS = 10L;

  /** Model round trips per turn in the plain ReAct loop. */
  private static final int MAX_HOPS = 12;
  /** Step-log sequence numbers below this belong to ensure / restore / persist. */
  private static final int INFER_STEP_BASE = 10;
  private static final int STEPS_PER_HOP = 2;
  private static final long MIN_TOOLS_WAIT_MS = 1_000L;

  private static final String DEFAULT_SANDBOX_ROOT = "/workspace";
  private static final String TOOLS_MODE_SKIP = "skip";
  private static final String ENGINE_REACT = "react";
  private static final String STEER_PREFIX = "停止原计划，改做：";
  private static final String TOOL_ERROR_PREFIX = "tool error";

  private final ToolsHub toolsHub;
  private final LoopProperties properties;
  private final FileStepLog stepLog;
  private final FileAgentStateStore sessions;
  private final ObjectMapper json = new ObjectMapper();
  private final ThreadPoolExecutor workers =
      new ThreadPoolExecutor(
          TURN_THREADS,
          TURN_THREADS,
          TURN_THREAD_KEEP_ALIVE_SECONDS,
          TimeUnit.SECONDS,
          new ArrayBlockingQueue<>(TURN_QUEUE_CAPACITY),
          namedThreads("neo-loop-turn-"),
          new ThreadPoolExecutor.AbortPolicy());
  private final ConcurrentHashMap<String, LiveTurn> live = new ConcurrentHashMap<>();

  private record LiveTurn(StartTurnCommand cmd, AtomicBoolean aborted, String steerText, String phase, Instant startedAt) {}

  public LocalTurnEngine(ToolsHub toolsHub, LoopProperties properties) {
    this.toolsHub = toolsHub;
    this.properties = properties;
    var root = properties.resolveStateDir();
    this.stepLog = new FileStepLog(root);
    this.sessions = new FileAgentStateStore(root);
    this.workers.allowCoreThreadTimeOut(true);
  }

  @PostConstruct
  void recoverIncompleteTurns() {
    for (StartTurnCommand cmd : stepLog.listIncompleteTurns()) {
      if (!live.containsKey(cmd.turnId())) {
        start(cmd);
      }
    }
  }

  @PreDestroy
  void shutdown() throws InterruptedException {
    workers.shutdown();
    if (!workers.awaitTermination(SHUTDOWN_WAIT_SECONDS, TimeUnit.SECONDS)) {
      LOG.warn("turn workers still busy after {}s; unfinished turns resume on next start", SHUTDOWN_WAIT_SECONDS);
    }
  }

  @Override
  public TurnHandle start(StartTurnCommand cmd) {
    live.put(cmd.turnId(), new LiveTurn(cmd, new AtomicBoolean(false), null, "ensure", Instant.now()));
    stepLog.append(cmd.runId(), cmd.turnId(), 0, "turn_started", "started", encode(cmd), "");
    try {
      workers.execute(() -> runTurn(cmd));
    } catch (RejectedExecutionException error) {
      live.remove(cmd.turnId());
      stepLog.append(cmd.runId(), cmd.turnId(), 1, "turn_completed", "error", "", "loop busy");
      throw new IllegalStateException("neo-loop is busy; turn " + cmd.turnId() + " was not started", error);
    }
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
      live.put(turnId, new LiveTurn(current.cmd, current.aborted, signal.text(), current.phase, current.startedAt));
      toolsHub.abortAll(current.cmd.runId());
    }
  }

  private String encode(StartTurnCommand cmd) {
    try {
      return json.writeValueAsString(cmd);
    } catch (JsonProcessingException error) {
      LOG.warn("turn {} command not serializable; recovery will skip it", cmd.turnId(), error);
      return cmd.text();
    }
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
      if (cmd.tools() == null || !TOOLS_MODE_SKIP.equals(cmd.tools().mode())) {
        toolsHub.awaitReady(cmd.runId(), Duration.ofMillis(Math.max(MIN_TOOLS_WAIT_MS, properties.getToolsWaitMs())));
      }
      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "ensure", "done", "", "ready");

      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "restore", "started", "", "");
      updatePhase(cmd.turnId(), "restore");
      Map<String, Object> session = restoreSession(cmd, cloud);
      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "restore", "done", "", "");

      mapper.agentStart();
      String userText = cmd.text();
      LiveTurn liveTurn = live.get(cmd.turnId());
      if (liveTurn != null && liveTurn.steerText != null && !liveTurn.steerText.isBlank()) {
        userText = STEER_PREFIX + liveTurn.steerText + "\n\n原始任务：\n" + cmd.text();
      }

      boolean usedHarness = false;
      if (!ENGINE_REACT.equalsIgnoreCase(properties.getEngine())) {
        usedHarness = runHarness(cmd, cloud, mapper, userText);
      }
      if (!usedHarness) {
        runActivityLoop(cmd, cloud, mapper, userText);
      }

      if (liveTurn != null && liveTurn.aborted.get()) {
        stepLog.append(cmd.runId(), cmd.turnId(), ++step, "turn_completed", "done", "", "cancelled");
        cloud.complete(cmd.runId(), cmd.turnId(), "idle", "cancelled", true);
        return;
      }

      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "persist", "started", "", "");
      updatePhase(cmd.turnId(), "persist");
      session.put("lastTurnId", cmd.turnId());
      session.put("lastDelivery", cmd.delivery());
      sessions.save(cmd.runId(), session);
      try {
        cloud.saveSession(cmd.runId(), session);
      } catch (RuntimeException error) {
        LOG.warn("run {} session not saved to control plane; local file copy is kept", cmd.runId(), error);
      }
      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "persist", "done", "", "");
      stepLog.append(cmd.runId(), cmd.turnId(), ++step, "turn_completed", "done", "", "idle");
      updatePhase(cmd.turnId(), "done");
      cloud.complete(cmd.runId(), cmd.turnId(), "idle", null, false);
    } catch (Exception error) {
      failTurn(cmd, mapper, cloud, ++step, error);
    } finally {
      live.remove(cmd.turnId());
    }
  }

  /** Every step is best-effort: turn-complete is the source of truth, and the step log stops a replay. */
  private void failTurn(StartTurnCommand cmd, AgentEventMapper mapper, ControlPlaneClient cloud, int step, Exception error) {
    LOG.warn("turn {} on run {} failed", cmd.turnId(), cmd.runId(), error);
    try {
      mapper.rewindStreamed();
      mapper.error(error.getMessage());
    } catch (RuntimeException emitError) {
      LOG.warn("turn {} error event not delivered", cmd.turnId(), emitError);
    }
    try {
      stepLog.append(cmd.runId(), cmd.turnId(), step, "turn_completed", "error", "", error.getMessage());
    } catch (RuntimeException logError) {
      LOG.warn("turn {} failure not journaled; it may be retried on restart", cmd.turnId(), logError);
    }
    try {
      cloud.complete(cmd.runId(), cmd.turnId(), "error", error.getMessage(), false);
    } catch (RuntimeException completeError) {
      LOG.warn("turn {} turn-complete not delivered; control plane will time out", cmd.turnId(), completeError);
    }
  }

  private boolean runHarness(StartTurnCommand cmd, ControlPlaneClient cloud, AgentEventMapper mapper, String userText) {
    NeoSandbox sandbox = new NeoSandbox(toolsHub, cmd.runId(), sandboxRoot(cmd));
    NeoHarnessFactory.BuiltAgent built = new NeoHarnessFactory().create(cmd, sandbox, cloud);
    HarnessAgent harness = built.harness();
    ReActAgent agent = built.react();
    RuntimeContext ctx = RuntimeContext.builder().userId(cmd.userId()).sessionId(cmd.runId()).build();
    try {
      Flux<?> stream = harness != null ? harness.streamEvents(userText, ctx) : agent.streamEvents(userText, ctx);
      stream
          .doOnNext(
              event -> {
                if (event instanceof AgentEvent agentEvent) {
                  mapper.accept(agentEvent);
                }
              })
          .blockLast();
      return true;
    } catch (RuntimeException error) {
      mapper.rewindStreamed();
      throw error;
    }
  }

  private void runActivityLoop(StartTurnCommand cmd, ControlPlaneClient cloud, AgentEventMapper mapper, String userText) {
    InferActivity infer = new InferActivity();
    ToolActivity tools = new ToolActivity();
    NeoSandbox sandbox = new NeoSandbox(toolsHub, cmd.runId(), sandboxRoot(cmd));
    List<Map<String, Object>> messages = new ArrayList<>();
    messages.add(Map.of("role", "system", "content", NeoHarnessFactory.systemPrompt(cmd)));
    messages.add(Map.of("role", "user", "content", userText));
    List<Map<String, Object>> toolSchemas = defaultTools();
    boolean visible = false;
    for (int hop = 0; hop < MAX_HOPS; hop++) {
      LiveTurn liveTurn = live.get(cmd.turnId());
      if (liveTurn != null && liveTurn.aborted.get()) {
        return;
      }
      if (liveTurn != null && liveTurn.steerText != null && hop > 0) {
        messages.add(Map.of("role", "user", "content", STEER_PREFIX + liveTurn.steerText));
        live.put(cmd.turnId(), new LiveTurn(liveTurn.cmd, liveTurn.aborted, null, "infer", liveTurn.startedAt));
      }
      updatePhase(cmd.turnId(), "infer");
      String stepId = cmd.turnId() + ":infer:" + hop;
      int inferStep = INFER_STEP_BASE + hop * STEPS_PER_HOP;
      stepLog.append(cmd.runId(), cmd.turnId(), inferStep, "infer_started", "started", userText, "");
      InferActivity.InferResult result;
      try {
        result = infer.run(cmd.llmGatewayUrl(), cmd.jwt(), cmd.model(), messages, toolSchemas, stepId);
      } catch (RuntimeException error) {
        mapper.rewindStreamed();
        throw error;
      }
      stepLog.append(cmd.runId(), cmd.turnId(), inferStep + 1, "infer_done", "done", "", result.raw());
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
      messages.add(assistantToolCallMessage(result));
      List<Map<String, Object>> toolMessages = new ArrayList<>(result.toolCalls().size());
      for (InferActivity.ToolCall call : result.toolCalls()) {
        updatePhase(cmd.turnId(), "tool");
        mapper.toolStart(call.name(), call.id(), call.arguments());
        String output = tools.run(call.name(), call.arguments(), sandbox, cloud, cmd.runId());
        mapper.toolEnd(call.name(), call.id(), output, output.startsWith(TOOL_ERROR_PREFIX));
        visible = true;
        toolMessages.add(Map.of("role", "tool", "tool_call_id", call.id(), "content", output));
      }
      messages.addAll(toolMessages);
    }
  }

  private static Map<String, Object> assistantToolCallMessage(InferActivity.InferResult result) {
    List<Map<String, Object>> encodedCalls = new ArrayList<>(result.toolCalls().size());
    for (InferActivity.ToolCall call : result.toolCalls()) {
      encodedCalls.add(
          Map.of("id", call.id(), "type", "function", "function", Map.of("name", call.name(), "arguments", call.arguments())));
    }
    Map<String, Object> assistant = LinkedMaps.withExpectedSize(3);
    assistant.put("role", "assistant");
    assistant.put("content", result.content() == null ? "" : result.content());
    assistant.put("tool_calls", encodedCalls);
    return assistant;
  }

  private Map<String, Object> restoreSession(StartTurnCommand cmd, ControlPlaneClient cloud) {
    Map<String, Object> local = sessions.load(cmd.runId());
    Map<String, Object> remote = Map.of();
    try {
      Map<String, Object> loaded = cloud.loadSession(cmd.runId());
      if (loaded != null) {
        remote = loaded;
      }
    } catch (RuntimeException error) {
      LOG.warn("run {} control-plane session unavailable; using the local file copy", cmd.runId(), error);
    }
    Map<String, Object> chosen = SessionRestore.choose(local, remote);
    if (chosen != local && !chosen.isEmpty()) {
      sessions.save(cmd.runId(), chosen);
    }
    return chosen;
  }

  private void updatePhase(String turnId, String phase) {
    LiveTurn current = live.get(turnId);
    if (current != null) {
      live.put(turnId, new LiveTurn(current.cmd, current.aborted, current.steerText, phase, current.startedAt));
    }
  }

  private static String sandboxRoot(StartTurnCommand cmd) {
    return cmd.tools() == null ? DEFAULT_SANDBOX_ROOT : cmd.tools().sandboxRoot();
  }

  private static ThreadFactory namedThreads(String prefix) {
    AtomicInteger counter = new AtomicInteger();
    return runnable -> {
      Thread thread = new Thread(runnable, prefix + counter.incrementAndGet());
      thread.setDaemon(true);
      return thread;
    };
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
        Map.of("name", name, "description", description, "parameters", Map.of("type", "object", "properties", properties, "required", required)));
  }
}
