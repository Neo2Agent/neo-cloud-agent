package cloud.neorun.loop.agent;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import java.util.List;
import org.junit.jupiter.api.Test;
import cloud.neorun.loop.cloud.ControlPlaneClient;
import cloud.neorun.loop.sandbox.NeoSandbox;
import cloud.neorun.loop.sandbox.ToolsHub;
import cloud.neorun.loop.turn.StartTurnCommand;

class NeoHarnessFactoryTest {
  @Test
  void buildsHarnessAgentWithoutTouchingTheHostDisk() {
    StartTurnCommand cmd =
        new StartTurnCommand(
            "run-h",
            "turn-h",
            "org",
            "user",
            "prompt",
            "hi",
            List.of(),
            "neo/deepseek",
            "jwt",
            "http://127.0.0.1:8081",
            "http://127.0.0.1:8080",
            new StartTurnCommand.ToolsBinding("skip", "inbound", null, "/workspace"),
            null,
            List.of(),
            null);
    NeoHarnessFactory.BuiltAgent built =
        new NeoHarnessFactory()
            .create(cmd, new NeoSandbox(new ToolsHub(), "run-h", "/workspace"), new ControlPlaneClient("http://127.0.0.1:9", "jwt"));
    assertNotNull(built.harness());
    assertNotNull(built.react());
    assertNotNull(built.harness().getDelegate());
  }
}
