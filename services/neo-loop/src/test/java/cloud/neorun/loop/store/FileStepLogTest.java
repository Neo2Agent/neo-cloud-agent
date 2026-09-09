package cloud.neorun.loop.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import cloud.neorun.loop.turn.StartTurnCommand;

class FileStepLogTest {
  @TempDir Path temp;

  @Test
  void incompleteTurnsRoundTripTheStartCommand() {
    FileStepLog log = new FileStepLog(temp);
    StartTurnCommand cmd =
        new StartTurnCommand(
            "run-1",
            "turn-1",
            "org",
            "user",
            "prompt",
            "say hello",
            List.of(),
            "neo/deepseek",
            "jwt",
            "http://127.0.0.1:8081",
            "http://127.0.0.1:8080",
            new StartTurnCommand.ToolsBinding("skip", "inbound", null, "/workspace"),
            new StartTurnCommand.WorkspaceContext("# toy", null, List.of(), null),
            List.of(),
            null);
    log.append("run-1", "turn-1", 0, "turn_started", "started", write(cmd), "");
    List<StartTurnCommand> incomplete = log.listIncompleteTurns();
    assertEquals(1, incomplete.size());
    assertEquals("say hello", incomplete.getFirst().text());
    assertEquals("run-1", incomplete.getFirst().runId());
    log.append("run-1", "turn-1", 1, "turn_completed", "done", "", "idle");
    assertTrue(log.listIncompleteTurns().isEmpty());
  }

  private static String write(StartTurnCommand cmd) {
    try {
      return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(cmd);
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }
}
