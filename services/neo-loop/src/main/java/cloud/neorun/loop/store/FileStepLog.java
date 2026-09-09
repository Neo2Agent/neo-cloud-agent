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
import com.fasterxml.jackson.databind.ObjectMapper;
import cloud.neorun.loop.turn.StartTurnCommand;

public class FileStepLog {
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
      Files.writeString(
          file,
          mapper.writeValueAsString(row) + "\n",
          StandardCharsets.UTF_8,
          StandardOpenOption.CREATE,
          StandardOpenOption.APPEND);
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
        for (Path file : stream.filter(path -> path.getFileName().toString().endsWith(".jsonl")).toList()) {
          String turnId = file.getFileName().toString().replaceFirst("\\.jsonl$", "");
          List<Map<String, Object>> rows = read(turnId);
          boolean completed = rows.stream().anyMatch(row -> "turn_completed".equals(String.valueOf(row.get("kind"))));
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

  public StartTurnCommand commandFrom(List<Map<String, Object>> rows) {
    for (Map<String, Object> row : rows) {
      if (!"turn_started".equals(String.valueOf(row.get("kind")))) {
        continue;
      }
      Object raw = row.get("requestJson");
      if (!(raw instanceof String text) || text.isBlank()) {
        continue;
      }
      try {
        return mapper.readValue(text, StartTurnCommand.class);
      } catch (IOException ignored) {
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
        if (line.isBlank()) {
          continue;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> row = mapper.readValue(line, Map.class);
        rows.add(row);
      }
      return rows;
    } catch (IOException error) {
      throw new IllegalStateException("loop step log read failed", error);
    }
  }

  private Path fileFor(String turnId) {
    return root.resolve("turns").resolve(turnId + ".jsonl");
  }
}
