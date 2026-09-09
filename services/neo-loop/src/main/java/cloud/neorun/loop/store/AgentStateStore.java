package cloud.neorun.loop.store;

import java.util.Map;

public interface AgentStateStore {
  Map<String, Object> load(String runId);

  void save(String runId, Map<String, Object> state);
}
