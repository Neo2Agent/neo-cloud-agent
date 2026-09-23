package cloud.neorun.loop.sandbox;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Request/response bridge over the per-run tools WebSocket. Each call waits on a future keyed by
 * its call id until the worker answers.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
@Component
public class ToolsHub {
  private static final long READY_POLL_MS = 50L;
  private static final long MIN_EXEC_WAIT_MS = 1_000L;
  /** Extra time past the command timeout for the worker to report exec.end. */
  private static final long EXEC_REPLY_GRACE_MS = 5_000L;
  private static final long FS_TIMEOUT_SECONDS = 30L;
  private static final int DEFAULT_EXIT_CODE = 1;

  /**
   * Collected output of one exec call.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  public record ExecResult(int exitCode, String stdout, String stderr) {}

  /**
   * Result of one fs call.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  public record FsResult(boolean ok, String message, String bytesB64) {}

  private final ObjectMapper mapper = new ObjectMapper();
  private final ConcurrentHashMap<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, CompletableFuture<Object>> pending = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, StringBuilder> stdout = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, StringBuilder> stderr = new ConcurrentHashMap<>();

  public void attach(String runId, WebSocketSession session) {
    sessions.put(runId, session);
  }

  public void detach(String runId, WebSocketSession session) {
    sessions.remove(runId, session);
  }

  public boolean ready(String runId) {
    WebSocketSession session = sessions.get(runId);
    return session != null && session.isOpen();
  }

  public void awaitReady(String runId, Duration timeout) {
    long deadline = System.currentTimeMillis() + timeout.toMillis();
    while (System.currentTimeMillis() < deadline) {
      if (ready(runId)) {
        return;
      }
      try {
        Thread.sleep(READY_POLL_MS);
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException("interrupted waiting for tools channel", error);
      }
    }
    throw new IllegalStateException("tools channel not ready for " + runId);
  }

  public ExecResult exec(String runId, String command, int timeoutMs, String cwd) {
    String callId = UUID.randomUUID().toString();
    CompletableFuture<Object> future = new CompletableFuture<>();
    pending.put(callId, future);
    stdout.put(callId, new StringBuilder());
    stderr.put(callId, new StringBuilder());
    try {
      send(runId, ToolsFrame.exec(callId, command, timeoutMs, cwd));
      Object result = future.get(Math.max(timeoutMs, MIN_EXEC_WAIT_MS) + EXEC_REPLY_GRACE_MS, TimeUnit.MILLISECONDS);
      if (result instanceof ExecResult exec) {
        return exec;
      }
      throw new IllegalStateException("unexpected exec result");
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      abortQuietly(runId, callId);
      throw new IllegalStateException("exec interrupted", error);
    } catch (ExecutionException | TimeoutException error) {
      abortQuietly(runId, callId);
      throw new IllegalStateException("exec failed", error);
    } finally {
      pending.remove(callId);
      stdout.remove(callId);
      stderr.remove(callId);
    }
  }

  public FsResult upload(String runId, String path, String bytesB64) {
    return fs(runId, ToolsFrame.upload(UUID.randomUUID().toString(), path, bytesB64));
  }

  public FsResult download(String runId, String path) {
    return fs(runId, ToolsFrame.download(UUID.randomUUID().toString(), path));
  }

  public void abortAll(String runId) {
    if (ready(runId)) {
      send(runId, ToolsFrame.abortAll());
    }
  }

  public void onFrame(String runId, Map<String, Object> frame) {
    String type = String.valueOf(frame.getOrDefault("type", ""));
    String callId = String.valueOf(frame.getOrDefault("callId", ""));
    if ("exec.stdout".equals(type)) {
      stdout.computeIfAbsent(callId, ignored -> new StringBuilder()).append(String.valueOf(frame.getOrDefault("text", "")));
      return;
    }
    if ("exec.stderr".equals(type)) {
      stderr.computeIfAbsent(callId, ignored -> new StringBuilder()).append(String.valueOf(frame.getOrDefault("text", "")));
      return;
    }
    if ("exec.end".equals(type)) {
      CompletableFuture<Object> wait = pending.remove(callId);
      if (wait != null) {
        int code = ((Number) frame.getOrDefault("exitCode", DEFAULT_EXIT_CODE)).intValue();
        wait.complete(
            new ExecResult(
                code,
                stdout.getOrDefault(callId, new StringBuilder()).toString(),
                stderr.getOrDefault(callId, new StringBuilder()).toString()));
      }
      return;
    }
    if ("ok".equals(type) || "err".equals(type)) {
      CompletableFuture<Object> wait = pending.remove(callId);
      if (wait != null) {
        wait.complete(
            new FsResult(
                "ok".equals(type),
                String.valueOf(frame.getOrDefault("message", "")),
                frame.get("bytesB64") == null ? null : String.valueOf(frame.get("bytesB64"))));
      }
    }
  }

  private FsResult fs(String runId, Map<String, Object> frame) {
    String callId = String.valueOf(frame.get("callId"));
    CompletableFuture<Object> future = new CompletableFuture<>();
    pending.put(callId, future);
    try {
      send(runId, frame);
      Object result = future.get(FS_TIMEOUT_SECONDS, TimeUnit.SECONDS);
      if (result instanceof FsResult fs) {
        return fs;
      }
      throw new IllegalStateException("unexpected fs result");
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("fs call interrupted", error);
    } catch (ExecutionException | TimeoutException error) {
      throw new IllegalStateException("fs call failed", error);
    } finally {
      pending.remove(callId);
    }
  }

  /** The channel may already be gone; the original failure is what the caller needs. */
  private void abortQuietly(String runId, String callId) {
    if (ready(runId)) {
      send(runId, ToolsFrame.abort(callId));
    }
  }

  private void send(String runId, Map<String, Object> frame) {
    WebSocketSession session = sessions.get(runId);
    if (session == null || !session.isOpen()) {
      throw new IllegalStateException("tools channel closed for " + runId);
    }
    try {
      synchronized (session) {
        session.sendMessage(new TextMessage(mapper.writeValueAsString(frame)));
      }
    } catch (IOException error) {
      throw new IllegalStateException("tools send failed", error);
    }
  }
}
