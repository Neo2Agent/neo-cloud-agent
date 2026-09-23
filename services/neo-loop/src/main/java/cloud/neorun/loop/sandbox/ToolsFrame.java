package cloud.neorun.loop.sandbox;

import java.util.Map;
import cloud.neorun.loop.support.LinkedMaps;

/**
 * Frames the loop sends on the tools WebSocket. Must match {@code contracts/src/tools-channel.ts}.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public final class ToolsFrame {
  private static final int PROTOCOL_VERSION = 1;
  private static final int MAX_FRAME_FIELDS = 6;

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

  public static Map<String, Object> abort(String callId) {
    Map<String, Object> frame = base("abort");
    frame.put("callId", callId);
    return frame;
  }

  public static Map<String, Object> abortAll() {
    return base("abort_all");
  }

  private static Map<String, Object> base(String type) {
    Map<String, Object> frame = LinkedMaps.withExpectedSize(MAX_FRAME_FIELDS);
    frame.put("v", PROTOCOL_VERSION);
    frame.put("type", type);
    return frame;
  }
}
