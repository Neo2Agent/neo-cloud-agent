package cloud.neorun.loop.store;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import cloud.neorun.loop.turn.StartTurnCommand;

/**
 * Append-only JSONL journal per turn under {@code <stateDir>/turns}. A turn without
 * {@code turn_completed} is replayed from its {@code turn_started} row on restart.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class FileStepLog {
  private static final Logger LOG = LoggerFactory.getLogger(FileStepLog.class);

  private static final String TURN_STARTED = "turn_started";
  private static final String TURN_COMPLETED = "turn_completed";
  private static final String JOURNAL_SUFFIX = ".jsonl";
  private static final TypeReference<Map<String, Object>> JSON_OBJECT = new TypeReference<>() {};

  private final Path root;
  private final ObjectMapper mapper = new ObjectMapper();

  public FileStepLog(Path root) {
    this.root = root;
  }

  public synchronized void append(
      String runId, String turnId, int stepSeq, String kind, String status, String requestJson, String resultJson) {
    try {
      Path file = fileFor(turnId);
      Files.createDirectories(file.getParent());
      Map<String, Object> row =
          Map.of(
              "runId", runId,
              "turnId", turnId,
              "stepSeq", stepSeq,
              "kind", kind,
              "status", status,
              "requestJson", requestJson == null ? "" : requestJson,
              "resultJson", resultJson == null ? "" : resultJson,
              "createdAt", Instant.now().toString());
      Files.writeString(file, mapper.writeValueAsString(row) + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (IOException error) {
      throw new IllegalStateException("loop step log failed", error);
    }
  }

  public List<StartTurnCommand> listIncompleteTurns() {
    Path dir = root.resolve("turns");
    if (!Files.isDirectory(dir)) {
      return List.of();
    }
    try {
      List<StartTurnCommand> incomplete = new ArrayList<>();
      try (var stream = Files.list(dir)) {
        for (Path file : stream.filter(path -> path.getFileName().toString().endsWith(JOURNAL_SUFFIX)).toList()) {
          String turnId = file.getFileName().toString().replaceFirst("\\.jsonl$", "");
          List<Map<String, Object>> rows = read(turnId);
          boolean completed = rows.stream().anyMatch(row -> TURN_COMPLETED.equals(String.valueOf(row.get("kind"))));
          if (completed) {
            continue;
          }
          StartTurnCommand cmd = commandFrom(rows);
          if (cmd != null) {
            incomplete.add(cmd);
          }
        }
      }
      return incomplete;
    } catch (IOException error) {
      throw new IllegalStateException("loop step scan failed", error);
    }
  }

  /** The {@code turn_started} command, or null when the journal has none that parses. */
  public StartTurnCommand commandFrom(List<Map<String, Object>> rows) {
    for (Map<String, Object> row : rows) {
      if (!TURN_STARTED.equals(String.valueOf(row.get("kind")))) {
        continue;
      }
      Object raw = row.get("requestJson");
      if (!(raw instanceof String text) || text.isBlank()) {
        continue;
      }
      try {
        return mapper.readValue(text, StartTurnCommand.class);
      } catch (IOException error) {
        LOG.warn("turn {} start command unreadable; it will not be resumed", row.get("turnId"), error);
        return null;
      }
    }
    return null;
  }

  public List<Map<String, Object>> read(String turnId) {
    Path file = fileFor(turnId);
    if (!Files.exists(file)) {
      return List.of();
    }
    try {
      List<Map<String, Object>> rows = new ArrayList<>();
      for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
        if (!line.isBlank()) {
          rows.add(mapper.readValue(line, JSON_OBJECT));
        }
      }
      return rows;
    } catch (IOException error) {
      throw new IllegalStateException("loop step log read failed", error);
    }
  }

  private Path fileFor(String turnId) {
    return root.resolve("turns").resolve(turnId + JOURNAL_SUFFIX);
  }
}
