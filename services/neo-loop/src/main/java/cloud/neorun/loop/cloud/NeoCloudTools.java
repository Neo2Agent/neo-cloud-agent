package cloud.neorun.loop.cloud;

import java.util.List;
import java.util.Map;
import io.agentscope.core.tool.Tool;
import io.agentscope.core.tool.ToolParam;

/**
 * Delivery and memory tools for the AgentScope agents. Every call goes through the control plane;
 * the loop never holds git or provider credentials.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class NeoCloudTools {
  private static final String PATH_SEPARATOR = ",";
  private static final String DEFAULT_ARTIFACT_NAME = "artifact";
  private static final String EMPTY_JSON = "{}";

  private final ControlPlaneClient client;
  private final String runId;

  public NeoCloudTools(ControlPlaneClient client, String runId) {
    this.client = client;
    this.runId = runId;
  }

  @Tool(name = "neo_git_commit", description = "Commit workspace changes through the control plane. Do not git push from the shell.")
  public String gitCommit(@ToolParam(name = "message") String message, @ToolParam(name = "paths") String paths) {
    List<String> pathList = paths == null ? List.of() : List.of(paths.split(PATH_SEPARATOR));
    return String.valueOf(client.postCloud(runPath("/scm/commit"), Map.of("message", nullToEmpty(message), "paths", pathList)));
  }

  @Tool(name = "neo_pr_open", description = "Open a draft pull request through the control plane.")
  public String prOpen(@ToolParam(name = "title") String title, @ToolParam(name = "body") String body) {
    return String.valueOf(client.postCloud(runPath("/scm/pull-request"), Map.of("title", nullToEmpty(title), "body", nullToEmpty(body))));
  }

  @Tool(name = "neo_diag", description = "Read run diagnostics from the control plane.")
  public String diag() {
    return String.valueOf(client.postCloud(runPath("/diagnostics"), Map.of()));
  }

  @Tool(name = "neo_mcp_list", description = "List MCP tools available to this run.")
  public String mcpList() {
    return String.valueOf(client.postCloud(runPath("/mcp"), Map.of("action", "list")));
  }

  @Tool(name = "neo_mcp_call", description = "Call an MCP tool through the control plane.")
  public String mcpCall(@ToolParam(name = "name") String name, @ToolParam(name = "arguments") String arguments) {
    return String.valueOf(
        client.postCloud(
            runPath("/mcp"), Map.of("action", "call", "name", nullToEmpty(name), "arguments", arguments == null ? EMPTY_JSON : arguments)));
  }

  @Tool(name = "neo_memory_add", description = "Add a user or project memory.")
  public String memoryAdd(@ToolParam(name = "text") String text) {
    return String.valueOf(client.postCloud(runPath("/memories"), Map.of("action", "add", "text", nullToEmpty(text))));
  }

  @Tool(name = "neo_memory_search", description = "Search memories for this user or project.")
  public String memorySearch(@ToolParam(name = "query") String query) {
    return String.valueOf(client.postCloud(runPath("/memories"), Map.of("action", "search", "query", nullToEmpty(query))));
  }

  @Tool(name = "neo_artifact_upload", description = "Upload an artifact through the control plane.")
  public String artifactUpload(@ToolParam(name = "name") String name, @ToolParam(name = "content") String content) {
    return String.valueOf(
        client.postCloud(runPath("/artifacts"), Map.of("name", name == null ? DEFAULT_ARTIFACT_NAME : name, "content", nullToEmpty(content))));
  }

  private String runPath(String suffix) {
    return "/internal/runs/" + runId + suffix;
  }

  private static String nullToEmpty(String value) {
    return value == null ? "" : value;
  }
}
