package cloud.neorun.loop.api;

import cloud.neorun.loop.turn.StartTurnCommand;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Wire shapes for {@code /internal/loop/turns}. The control plane may send fields the loop does
 * not read yet; those are ignored.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public final class TurnDtos {
  private static final String DEFAULT_DELIVERY = "prompt";
  private static final String DEFAULT_TOOLS_MODE = "worker_ws";
  private static final String DEFAULT_SANDBOX_ROOT = "/workspace";

  private TurnDtos() {}

  /**
   * Body of {@code POST /internal/loop/turns}.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record StartTurnRequest(
      String runId,
      String turnId,
      String userId,
      String delivery,
      String text,
      String model,
      String jwt,
      String llmGatewayUrl,
      String controlPlaneUrl,
      Tools tools,
      Workspace workspace) {
    /**
     * Tools channel binding.
     *
     * @author neo-cloud-agent
     * @date 2026-09-04
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Tools(String mode, String sandboxRoot) {}

    /**
     * Workspace prompt context.
     *
     * @author neo-cloud-agent
     * @date 2026-09-04
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Workspace(String agentsMd, String expertMd, String systemPromptExtra) {}

    public StartTurnCommand toCommand() {
      return new StartTurnCommand(
          runId,
          turnId,
          userId,
          delivery == null ? DEFAULT_DELIVERY : delivery,
          text == null ? "" : text,
          model,
          jwt,
          llmGatewayUrl,
          controlPlaneUrl,
          tools == null
              ? new StartTurnCommand.ToolsBinding(DEFAULT_TOOLS_MODE, DEFAULT_SANDBOX_ROOT)
              : new StartTurnCommand.ToolsBinding(tools.mode, tools.sandboxRoot),
          workspace == null
              ? null
              : new StartTurnCommand.WorkspaceContext(workspace.agentsMd, workspace.expertMd, workspace.systemPromptExtra));
    }
  }

  /**
   * Response for start and signal.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  public record StartTurnResponse(String turnId, String runId, boolean accepted) {}

  /**
   * Body of {@code POST /internal/loop/turns/{turnId}/signal}.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record SignalRequest(String type, String text) {}
}
