package cloud.neorun.loop.turn;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Turn input as the engine consumes it. Also persisted in the step log so an unfinished turn can
 * resume after a restart; unknown fields from older logs are ignored.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record StartTurnCommand(
    String runId,
    String turnId,
    String userId,
    String delivery,
    String text,
    String model,
    String jwt,
    String llmGatewayUrl,
    String controlPlaneUrl,
    ToolsBinding tools,
    WorkspaceContext workspace) {
  /**
   * How the loop reaches the workspace tools. {@code skip} runs without a tools channel.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record ToolsBinding(String mode, String sandboxRoot) {}

  /**
   * Prompt context read from the workspace by the control plane.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record WorkspaceContext(String agentsMd, String expertMd, String systemPromptExtra) {}
}
