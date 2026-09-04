package cloud.neorun.loop.sandbox;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class ToolsHub {
  public record ExecResult(int exitCode, String stdout, String stderr) {}

  public record FsResult(boolean ok, String code, String message, String bytesB64, java.util.List<String> names, Boolean exists) {}

  private final ObjectMapper mapper = new ObjectMapper();
  private final ConcurrentHashMap<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Pending> pending = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, StringBuilder> stdout = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, StringBuilder> stderr = new ConcurrentHashMap<>();

  private record Pending(CompletableFuture<Object> future, String kind) {}

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
        Thread.sleep(50);
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
    pending.put(callId, new Pending(future, "exec"));
    stdout.put(callId, new StringBuilder());
    stderr.put(callId, new StringBuilder());
    send(runId, ToolsFrame.exec(callId, command, timeoutMs, cwd));
    try {
      Object result = future.get(Math.max(timeoutMs, 1_000) + 5_000L, TimeUnit.MILLISECONDS);
      if (result instanceof ExecResult exec) {
        return exec;
      }
      throw new IllegalStateException("unexpected exec result");
    } catch (Exception error) {
      send(runId, ToolsFrame.abort(callId));
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

  public FsResult list(String runId, String path) {
    return fs(runId, ToolsFrame.list(UUID.randomUUID().toString(), path));
  }

  public FsResult exists(String runId, String path) {
    return fs(runId, ToolsFrame.exists(UUID.randomUUID().toString(), path));
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
      Pending wait = pending.remove(callId);
      if (wait != null) {
        int code = ((Number) frame.getOrDefault("exitCode", 1)).intValue();
        wait.future.complete(
            new ExecResult(
                code,
                stdout.getOrDefault(callId, new StringBuilder()).toString(),
                stderr.getOrDefault(callId, new StringBuilder()).toString()));
      }
      return;
    }
    if ("ok".equals(type) || "err".equals(type)) {
      Pending wait = pending.remove(callId);
      if (wait == null) {
        return;
      }
      boolean ok = "ok".equals(type);
      @SuppressWarnings("unchecked")
      java.util.List<String> names =
          frame.get("names") instanceof java.util.List<?> list ? (java.util.List<String>) list : java.util.List.of();
      wait.future.complete(
          new FsResult(
              ok,
              String.valueOf(frame.getOrDefault("code", ok ? "" : "internal")),
              String.valueOf(frame.getOrDefault("message", "")),
              frame.get("bytesB64") == null ? null : String.valueOf(frame.get("bytesB64")),
              names,
              frame.get("exists") instanceof Boolean exists ? exists : null));
    }
  }

  private FsResult fs(String runId, Map<String, Object> frame) {
    String callId = String.valueOf(frame.get("callId"));
    CompletableFuture<Object> future = new CompletableFuture<>();
    pending.put(callId, new Pending(future, "fs"));
    send(runId, frame);
    try {
      Object result = future.get(30, TimeUnit.SECONDS);
      if (result instanceof FsResult fs) {
        return fs;
      }
      throw new IllegalStateException("unexpected fs result");
    } catch (Exception error) {
      throw new IllegalStateException("fs call failed", error);
    } finally {
      pending.remove(callId);
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
