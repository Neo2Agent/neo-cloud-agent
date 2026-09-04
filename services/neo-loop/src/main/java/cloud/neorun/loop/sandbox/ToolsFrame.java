package cloud.neorun.loop.sandbox;

import java.util.LinkedHashMap;
import java.util.Map;

public final class ToolsFrame {
  private ToolsFrame() {}

  public static Map<String, Object> hello(String runId, String sandboxRoot) {
    Map<String, Object> frame = base("hello");
    frame.put("runId", runId);
    frame.put("role", "loop");
    frame.put("sandboxRoot", sandboxRoot);
    return frame;
  }

  public static Map<String, Object> exec(String callId, String command, int timeoutMs, String cwd) {
    Map<String, Object> frame = base("exec");
    frame.put("callId", callId);
    frame.put("command", command);
    frame.put("timeoutMs", timeoutMs);
    if (cwd != null && !cwd.isBlank()) {
      frame.put("cwd", cwd);
    }
    return frame;
  }

  public static Map<String, Object> upload(String callId, String path, String bytesB64) {
    Map<String, Object> frame = base("fs.upload");
    frame.put("callId", callId);
    frame.put("path", path);
    frame.put("bytesB64", bytesB64);
    return frame;
  }

  public static Map<String, Object> download(String callId, String path) {
    Map<String, Object> frame = base("fs.download");
    frame.put("callId", callId);
    frame.put("path", path);
    return frame;
  }

  public static Map<String, Object> list(String callId, String path) {
    Map<String, Object> frame = base("fs.list");
    frame.put("callId", callId);
    frame.put("path", path);
    return frame;
  }

  public static Map<String, Object> exists(String callId, String path) {
    Map<String, Object> frame = base("fs.exists");
    frame.put("callId", callId);
    frame.put("path", path);
    return frame;
  }

  public static Map<String, Object> abort(String callId) {
    Map<String, Object> frame = base("abort");
    frame.put("callId", callId);
    return frame;
  }

  public static Map<String, Object> abortAll() {
    return base("abort_all");
  }

  public static Map<String, Object> ping() {
    return base("ping");
  }

  private static Map<String, Object> base(String type) {
    Map<String, Object> frame = new LinkedHashMap<>();
    frame.put("v", 1);
    frame.put("type", type);
    return frame;
  }
}
