package cloud.neorun.loop.api;

import java.util.List;
import java.util.Map;
import cloud.neorun.loop.turn.StartTurnCommand;

public final class TurnDtos {
  private TurnDtos() {}

  public record StartTurnRequest(
      String runId,
      String turnId,
      String orgId,
      String userId,
      String delivery,
      String text,
      List<Map<String, Object>> images,
      String model,
      String jwt,
      String llmGatewayUrl,
      String controlPlaneUrl,
      Tools tools,
      Workspace workspace,
      List<String> toolAllowlist,
      String followUpId) {
    public record Tools(String mode, String url, String leaseId, String sandboxRoot) {}

    public record Workspace(String agentsMd, String expertMd, List<String> skillRoots, String systemPromptExtra) {}

    public StartTurnCommand toCommand() {
      return new StartTurnCommand(
          runId,
          turnId,
          orgId,
          userId,
          delivery == null ? "prompt" : delivery,
          text == null ? "" : text,
          images,
          model,
          jwt,
          llmGatewayUrl,
          controlPlaneUrl,
          tools == null
              ? new StartTurnCommand.ToolsBinding("worker_ws", "inbound", null, "/workspace")
              : new StartTurnCommand.ToolsBinding(tools.mode, tools.url, tools.leaseId, tools.sandboxRoot),
          workspace == null
              ? null
              : new StartTurnCommand.WorkspaceContext(
                  workspace.agentsMd, workspace.expertMd, workspace.skillRoots, workspace.systemPromptExtra),
          toolAllowlist,
          followUpId);
    }
  }

  public record StartTurnResponse(String turnId, String runId, boolean accepted) {}

  public record SignalRequest(String type, String text, String followUpId) {}
}
