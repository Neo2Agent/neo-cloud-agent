package cloud.neorun.loop.sandbox;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import io.agentscope.core.tool.Tool;
import io.agentscope.core.tool.ToolParam;

/**
 * Workspace disk and shell for one run, reached over the tools WebSocket. The loop host never
 * touches the workspace directly.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class NeoSandbox {
  private static final String DEFAULT_SANDBOX_ROOT = "/workspace";
  private static final int DEFAULT_EXEC_TIMEOUT_MS = 60_000;

  private final ToolsHub hub;
  private final String runId;
  private final String sandboxRoot;

  public NeoSandbox(ToolsHub hub, String runId, String sandboxRoot) {
    this.hub = hub;
    this.runId = runId;
    this.sandboxRoot = sandboxRoot == null || sandboxRoot.isBlank() ? DEFAULT_SANDBOX_ROOT : sandboxRoot;
  }

  public ToolsHub.ExecResult exec(String command, int timeoutMs) {
    return hub.exec(runId, command, timeoutMs, sandboxRoot);
  }

  @Tool(name = "execute", description = "Run a POSIX shell command inside the leased workspace. cwd is the sandbox root.")
  public String execute(
      @ToolParam(name = "command", description = "POSIX sh -c command") String command,
      @ToolParam(name = "timeoutMs", description = "Timeout in milliseconds") Integer timeoutMs) {
    ToolsHub.ExecResult result = exec(command, timeoutMs == null ? DEFAULT_EXEC_TIMEOUT_MS : timeoutMs);
    String output = (result.stdout() + result.stderr()).trim();
    return "exit=" + result.exitCode() + (output.isEmpty() ? "" : "\n" + output);
  }

  @Tool(name = "read_file", description = "Read a UTF-8 file from the workspace.")
  public String readFile(@ToolParam(name = "path", description = "Path relative to the workspace") String path) {
    ToolsHub.FsResult result = hub.download(runId, path);
    if (!result.ok() || result.bytesB64() == null) {
      throw new IllegalStateException(result.message() == null ? "download failed" : result.message());
    }
    return new String(Base64.getDecoder().decode(result.bytesB64()), StandardCharsets.UTF_8);
  }

  @Tool(name = "write_file", description = "Write a UTF-8 file inside the workspace.")
  public String writeFile(
      @ToolParam(name = "path", description = "Path relative to the workspace") String path,
      @ToolParam(name = "content", description = "File contents") String content) {
    upload(path, content == null ? "" : content);
    return "wrote " + path;
  }

  @Tool(name = "edit_file", description = "Replace one occurrence of old_string with new_string in a workspace file.")
  public String editFile(
      @ToolParam(name = "path") String path,
      @ToolParam(name = "old_string") String oldString,
      @ToolParam(name = "new_string") String newString) {
    String current = readFile(path);
    int index = current.indexOf(oldString);
    if (index < 0) {
      throw new IllegalStateException("old_string not found in " + path);
    }
    upload(path, current.substring(0, index) + newString + current.substring(index + oldString.length()));
    return "edited " + path;
  }

  private void upload(String path, String content) {
    ToolsHub.FsResult result = hub.upload(runId, path, Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8)));
    if (!result.ok()) {
      throw new IllegalStateException(result.message() == null ? "upload failed" : result.message());
    }
  }
}
