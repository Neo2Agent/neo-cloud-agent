package cloud.neorun.loop.agent;

import cloud.neorun.loop.cloud.ControlPlaneClient;
import cloud.neorun.loop.cloud.NeoCloudTools;
import cloud.neorun.loop.sandbox.NeoSandbox;
import cloud.neorun.loop.turn.InferActivity;
import java.nio.file.Path;
import cloud.neorun.loop.turn.StartTurnCommand;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.tool.Toolkit;
import io.agentscope.harness.agent.HarnessAgent;

public class NeoHarnessFactory {
  public record BuiltAgent(ReActAgent react, HarnessAgent harness) {}

  public BuiltAgent create(StartTurnCommand cmd, NeoSandbox sandbox, ControlPlaneClient cloud) {
    GatewayChatModel model =
        new GatewayChatModel(new InferActivity(), cmd.llmGatewayUrl(), cmd.jwt(), cmd.model());
    Toolkit toolkit = new Toolkit();
    toolkit.registerTool(sandbox);
    toolkit.registerTool(new NeoCloudTools(cloud, cmd.runId()));
    String prompt = systemPrompt(cmd);
    ReActAgent react =
        ReActAgent.builder().name("neo").model(model).toolkit(toolkit).sysPrompt(prompt).maxIters(12).build();
    HarnessAgent harness =
        HarnessAgent.builder()
            .name("neo")
            .model(model)
            .toolkit(toolkit)
            .sysPrompt(prompt)
            .maxIters(12)
            .workspace(Path.of(System.getProperty("java.io.tmpdir"), "neo-loop-workspace"))
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
    if (cmd.workspace() != null && cmd.workspace().agentsMd() != null) {
      text.append("\n# AGENTS.md\n").append(cmd.workspace().agentsMd()).append('\n');
    }
    if (cmd.workspace() != null && cmd.workspace().expertMd() != null) {
      text.append("\n# EXPERT\n").append(cmd.workspace().expertMd()).append('\n');
    }
    if (cmd.workspace() != null && cmd.workspace().systemPromptExtra() != null) {
      text.append('\n').append(cmd.workspace().systemPromptExtra());
    }
    return text.toString();
  }
}
