package cloud.neorun.loop.store;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import cloud.neorun.loop.support.LinkedMaps;

/**
 * One JSON file per run under {@code <stateDir>/sessions}.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class FileAgentStateStore implements AgentStateStore {
  private static final int EMPTY_STATE_FIELDS = 3;
  private static final TypeReference<Map<String, Object>> JSON_OBJECT = new TypeReference<>() {};

  private final Path root;
  private final ObjectMapper mapper = new ObjectMapper();

  public FileAgentStateStore(Path root) {
    this.root = root;
  }

  @Override
  public Map<String, Object> load(String runId) {
    Path file = fileFor(runId);
    if (!Files.exists(file)) {
      Map<String, Object> empty = LinkedMaps.withExpectedSize(EMPTY_STATE_FIELDS);
      empty.put("runId", runId);
      empty.put("messages", List.of());
      empty.put("updatedAt", Instant.now().toString());
      return empty;
    }
    try {
      return mapper.readValue(Files.readString(file, StandardCharsets.UTF_8), JSON_OBJECT);
    } catch (IOException error) {
      throw new IllegalStateException("loop session load failed", error);
    }
  }

  @Override
  public void save(String runId, Map<String, Object> state) {
    try {
      Path file = fileFor(runId);
      Files.createDirectories(file.getParent());
      Map<String, Object> copy = LinkedMaps.withExpectedSize(state.size() + 2);
      copy.putAll(state);
      copy.put("runId", runId);
      copy.put("updatedAt", Instant.now().toString());
      Files.writeString(file, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(copy), StandardCharsets.UTF_8);
    } catch (IOException error) {
      throw new IllegalStateException("loop session save failed", error);
    }
  }

  private Path fileFor(String runId) {
    return root.resolve("sessions").resolve(runId + ".json");
  }
}
