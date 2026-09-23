package cloud.neorun.loop.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import cloud.neorun.loop.turn.StartTurnCommand;

/**
 * Journal replay for unfinished turns.
 *
 * @author neo-cloud-agent
 * @date 2026-09-09
 */
class FileStepLogTest {
  @TempDir Path temp;

  @Test
  void incompleteTurnsRoundTripTheStartCommand() throws JsonProcessingException {
    FileStepLog log = new FileStepLog(temp);
    StartTurnCommand cmd =
        new StartTurnCommand(
            "run-1",
            "turn-1",
            "user",
            "prompt",
            "say hello",
            "neo/deepseek",
            "jwt",
            "http://127.0.0.1:8081",
            "http://127.0.0.1:8080",
            new StartTurnCommand.ToolsBinding("skip", "/workspace"),
            new StartTurnCommand.WorkspaceContext("# toy", null, null));
    log.append("run-1", "turn-1", 0, "turn_started", "started", new ObjectMapper().writeValueAsString(cmd), "");
    List<StartTurnCommand> incomplete = log.listIncompleteTurns();
    assertEquals(1, incomplete.size());
    assertEquals("say hello", incomplete.getFirst().text());
    assertEquals("run-1", incomplete.getFirst().runId());
    log.append("run-1", "turn-1", 1, "turn_completed", "done", "", "idle");
    assertTrue(log.listIncompleteTurns().isEmpty());
  }

  @Test
  void journalsWrittenBeforeFieldsWereDroppedStillResume() {
    FileStepLog log = new FileStepLog(temp);
    String legacy =
        """
        {"runId":"run-2","turnId":"turn-2","orgId":"org","userId":"user","delivery":"prompt","text":"resume me",
         "images":[],"model":"neo/deepseek","jwt":"jwt","llmGatewayUrl":"http://127.0.0.1:8081",
         "controlPlaneUrl":"http://127.0.0.1:8080",
         "tools":{"mode":"skip","url":"inbound","leaseId":null,"sandboxRoot":"/workspace"},
         "workspace":{"agentsMd":"# toy","expertMd":null,"skillRoots":[],"systemPromptExtra":null},
         "toolAllowlist":[],"followUpId":null}
        """;
    log.append("run-2", "turn-2", 0, "turn_started", "started", legacy, "");
    List<StartTurnCommand> incomplete = log.listIncompleteTurns();
    assertEquals(1, incomplete.size());
    assertEquals("resume me", incomplete.getFirst().text());
    assertEquals("/workspace", incomplete.getFirst().tools().sandboxRoot());
  }
}
