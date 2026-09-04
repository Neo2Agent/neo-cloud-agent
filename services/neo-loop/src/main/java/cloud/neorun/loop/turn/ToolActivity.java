package cloud.neorun.loop.turn;

import java.util.Map;
import cloud.neorun.loop.cloud.ControlPlaneClient;
import cloud.neorun.loop.sandbox.NeoSandbox;
import cloud.neorun.loop.sandbox.ToolsHub;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

public class ToolActivity {
  private final ObjectMapper mapper = new ObjectMapper();

  public String run(String name, String arguments, NeoSandbox sandbox, ControlPlaneClient cloud, String runId) {
    JsonNode args;
    try {
      args = mapper.readTree(arguments == null || arguments.isBlank() ? "{}" : arguments);
    } catch (Exception error) {
      return "invalid tool arguments: " + error.getMessage();
    }
    try {
      return switch (name) {
        case "execute", "bash" -> {
          ToolsHub.ExecResult result = sandbox.exec(args.path("command").asText(""), args.path("timeoutMs").asInt(60_000));
          yield "exit=" + result.exitCode() + "\n" + result.stdout() + result.stderr();
        }
        case "read_file", "read" -> sandbox.readFile(args.path("path").asText());
        case "write_file", "write" -> {
          sandbox.writeFile(args.path("path").asText(), args.path("content").asText(""));
          yield "wrote " + args.path("path").asText();
        }
        case "edit_file", "edit" -> sandbox.edit_file(args.path("path").asText(), args.path("old_string").asText(), args.path("new_string").asText());
        case "neo_git_commit" ->
            String.valueOf(
                cloud.postCloud(
                    "/internal/runs/" + runId + "/scm/commit",
                    Map.of("message", args.path("message").asText(""), "paths", java.util.List.of())));
        case "neo_pr_open" ->
            String.valueOf(
                cloud.postCloud(
                    "/internal/runs/" + runId + "/scm/pull-request",
                    Map.of("title", args.path("title").asText(""), "body", args.path("body").asText(""))));
        default -> "unsupported tool: " + name;
      };
    } catch (Exception error) {
      return "tool error: " + error.getMessage();
    }
  }
}
