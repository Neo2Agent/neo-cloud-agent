package cloud.neorun.loop.store;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;

public class FileAgentStateStore {
  private final Path root;
  private final ObjectMapper mapper = new ObjectMapper();

  public FileAgentStateStore(Path root) {
    this.root = root;
  }

  public Map<String, Object> load(String runId) {
    Path file = fileFor(runId);
    if (!Files.exists(file)) {
      Map<String, Object> empty = new LinkedHashMap<>();
      empty.put("runId", runId);
      empty.put("messages", List.of());
      empty.put("updatedAt", Instant.now().toString());
      return empty;
    }
    try {
      @SuppressWarnings("unchecked")
      Map<String, Object> state = mapper.readValue(Files.readString(file, StandardCharsets.UTF_8), Map.class);
      return state;
    } catch (IOException error) {
      throw new IllegalStateException("loop session load failed", error);
    }
  }

  public void save(String runId, Map<String, Object> state) {
    try {
      Path file = fileFor(runId);
      Files.createDirectories(file.getParent());
      Map<String, Object> copy = new LinkedHashMap<>(state);
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
