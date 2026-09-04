package cloud.neorun.loop.cloud;

import java.util.Map;
import io.agentscope.core.tool.Tool;
import io.agentscope.core.tool.ToolParam;

public class NeoCloudTools {
  private final ControlPlaneClient client;
  private final String runId;

  public NeoCloudTools(ControlPlaneClient client, String runId) {
    this.client = client;
    this.runId = runId;
  }

  @Tool(name = "neo_git_commit", description = "Commit workspace changes through the control plane. Do not git push from the shell.")
  public String neo_git_commit(
      @ToolParam(name = "message") String message, @ToolParam(name = "paths") String paths) {
    return String.valueOf(
        client.postCloud(
            "/internal/runs/" + runId + "/scm/commit",
            Map.of("message", message == null ? "" : message, "paths", paths == null ? java.util.List.of() : java.util.List.of(paths.split(",")))));
  }

  @Tool(name = "neo_pr_open", description = "Open a draft pull request through the control plane.")
  public String neo_pr_open(@ToolParam(name = "title") String title, @ToolParam(name = "body") String body) {
    return String.valueOf(
        client.postCloud(
            "/internal/runs/" + runId + "/scm/pull-request",
            Map.of("title", title == null ? "" : title, "body", body == null ? "" : body)));
  }

  @Tool(name = "neo_diag", description = "Read run diagnostics from the control plane.")
  public String neo_diag() {
    return String.valueOf(client.postCloud("/internal/runs/" + runId + "/diagnostics", Map.of()));
  }

  @Tool(name = "neo_mcp_list", description = "List MCP tools available to this run.")
  public String neo_mcp_list() {
    return String.valueOf(client.postCloud("/internal/runs/" + runId + "/mcp", Map.of("action", "list")));
  }

  @Tool(name = "neo_mcp_call", description = "Call an MCP tool through the control plane.")
  public String neo_mcp_call(@ToolParam(name = "name") String name, @ToolParam(name = "arguments") String arguments) {
    return String.valueOf(
        client.postCloud(
            "/internal/runs/" + runId + "/mcp",
            Map.of("action", "call", "name", name == null ? "" : name, "arguments", arguments == null ? "{}" : arguments)));
  }

  @Tool(name = "neo_memory_add", description = "Add a user or project memory.")
  public String neo_memory_add(@ToolParam(name = "text") String text) {
    return String.valueOf(client.postCloud("/internal/runs/" + runId + "/memories", Map.of("action", "add", "text", text == null ? "" : text)));
  }

  @Tool(name = "neo_memory_search", description = "Search memories for this user or project.")
  public String neo_memory_search(@ToolParam(name = "query") String query) {
    return String.valueOf(
        client.postCloud("/internal/runs/" + runId + "/memories", Map.of("action", "search", "query", query == null ? "" : query)));
  }

  @Tool(name = "neo_artifact_upload", description = "Upload an artifact through the control plane.")
  public String neo_artifact_upload(@ToolParam(name = "name") String name, @ToolParam(name = "content") String content) {
    return String.valueOf(
        client.postCloud(
            "/internal/runs/" + runId + "/artifacts",
            Map.of("name", name == null ? "artifact" : name, "content", content == null ? "" : content)));
  }
}
