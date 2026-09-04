package cloud.neorun.loop.turn;

import java.util.List;
import java.util.Map;

public record StartTurnCommand(
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
    ToolsBinding tools,
    WorkspaceContext workspace,
    List<String> toolAllowlist,
    String followUpId) {
  public record ToolsBinding(String mode, String url, String leaseId, String sandboxRoot) {}

  public record WorkspaceContext(
      String agentsMd, String expertMd, List<String> skillRoots, String systemPromptExtra) {}
}
