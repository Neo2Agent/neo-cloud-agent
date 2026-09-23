package cloud.neorun.loop.turn;

import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import cloud.neorun.loop.cloud.ControlPlaneClient;
import cloud.neorun.loop.sandbox.NeoSandbox;
import cloud.neorun.loop.sandbox.ToolsHub;

/**
 * Executes one tool call for the plain ReAct loop. Failures become text the model can read.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class ToolActivity {
  private static final int DEFAULT_EXEC_TIMEOUT_MS = 60_000;
  private static final String EMPTY_ARGS = "{}";

  private final ObjectMapper mapper = new ObjectMapper();

  public String run(String name, String arguments, NeoSandbox sandbox, ControlPlaneClient cloud, String runId) {
    JsonNode args;
    try {
      args = mapper.readTree(arguments == null || arguments.isBlank() ? EMPTY_ARGS : arguments);
    } catch (JsonProcessingException error) {
      return "invalid tool arguments: " + error.getMessage();
    }
    try {
      return switch (name) {
        case "execute", "bash" -> {
          ToolsHub.ExecResult result = sandbox.exec(args.path("command").asText(""), args.path("timeoutMs").asInt(DEFAULT_EXEC_TIMEOUT_MS));
          yield "exit=" + result.exitCode() + "\n" + result.stdout() + result.stderr();
        }
        case "read_file", "read" -> sandbox.readFile(args.path("path").asText());
        case "write_file", "write" -> sandbox.writeFile(args.path("path").asText(), args.path("content").asText(""));
        case "edit_file", "edit" -> sandbox.editFile(args.path("path").asText(), args.path("old_string").asText(), args.path("new_string").asText());
        case "neo_git_commit" ->
            String.valueOf(
                cloud.postCloud("/internal/runs/" + runId + "/scm/commit", Map.of("message", args.path("message").asText(""), "paths", List.of())));
        case "neo_pr_open" ->
            String.valueOf(
                cloud.postCloud(
                    "/internal/runs/" + runId + "/scm/pull-request",
                    Map.of("title", args.path("title").asText(""), "body", args.path("body").asText(""))));
        default -> "unsupported tool: " + name;
      };
    } catch (RuntimeException error) {
      return "tool error: " + error.getMessage();
    }
  }
}
