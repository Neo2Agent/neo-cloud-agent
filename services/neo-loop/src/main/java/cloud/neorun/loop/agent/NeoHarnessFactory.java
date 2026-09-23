package cloud.neorun.loop.agent;

import java.nio.file.Path;
import cloud.neorun.loop.cloud.ControlPlaneClient;
import cloud.neorun.loop.cloud.NeoCloudTools;
import cloud.neorun.loop.sandbox.NeoSandbox;
import cloud.neorun.loop.turn.InferActivity;
import cloud.neorun.loop.turn.StartTurnCommand;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.tool.Toolkit;
import io.agentscope.harness.agent.HarnessAgent;

/**
 * Builds the AgentScope ReAct and Harness agents for one turn. Disk and shell go through
 * {@link NeoSandbox}; delivery goes through the control plane.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class NeoHarnessFactory {
  private static final String AGENT_NAME = "neo";
  /** Same ceiling as the plain ReAct loop in LocalTurnEngine. */
  private static final int MAX_ITERS = 12;
  private static final String HARNESS_WORKSPACE_DIR = "neo-loop-workspace";

  /**
   * Both agents share one model and toolkit; the engine prefers the harness when present.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  public record BuiltAgent(ReActAgent react, HarnessAgent harness) {}

  public BuiltAgent create(StartTurnCommand cmd, NeoSandbox sandbox, ControlPlaneClient cloud) {
    GatewayChatModel model = new GatewayChatModel(new InferActivity(), cmd.llmGatewayUrl(), cmd.jwt(), cmd.model());
    Toolkit toolkit = new Toolkit();
    toolkit.registerTool(sandbox);
    toolkit.registerTool(new NeoCloudTools(cloud, cmd.runId()));
    String prompt = systemPrompt(cmd);
    ReActAgent react =
        ReActAgent.builder().name(AGENT_NAME).model(model).toolkit(toolkit).sysPrompt(prompt).maxIters(MAX_ITERS).build();
    HarnessAgent harness =
        HarnessAgent.builder()
            .name(AGENT_NAME)
            .model(model)
            .toolkit(toolkit)
            .sysPrompt(prompt)
            .maxIters(MAX_ITERS)
            .workspace(Path.of(System.getProperty("java.io.tmpdir"), HARNESS_WORKSPACE_DIR))
            // Do not attach LocalFilesystemSpec shell. File/exec tools go through NeoSandbox.
            .disableShellTool()
            .disableFilesystemTools()
            .disableSessionPersistence()
            .disableWorkspaceContext()
            .disableSubagents()
            .build();
    return new BuiltAgent(react, harness);
  }

  public static String systemPrompt(StartTurnCommand cmd) {
    StringBuilder text = new StringBuilder();
    text.append("You are the Neo cloud coding agent. The workspace is already checked out.\n");
    text.append("Use execute / read_file / write_file / edit_file for disk and shell.\n");
    text.append("Do not git push. Use neo_git_commit / neo_pr_open for delivery.\n");
    text.append("Do not escape the sandbox. Isolation is SESSION.\n");
    StartTurnCommand.WorkspaceContext workspace = cmd.workspace();
    if (workspace != null && workspace.agentsMd() != null) {
      text.append("\n# AGENTS.md\n").append(workspace.agentsMd()).append('\n');
    }
    if (workspace != null && workspace.expertMd() != null) {
      text.append("\n# EXPERT\n").append(workspace.expertMd()).append('\n');
    }
    if (workspace != null && workspace.systemPromptExtra() != null) {
      text.append('\n').append(workspace.systemPromptExtra());
    }
    return text.toString();
  }
}
