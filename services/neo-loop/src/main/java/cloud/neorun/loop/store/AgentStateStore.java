package cloud.neorun.loop.store;

import java.util.Map;

/**
 * Per-run agent memory carried between turns.
 *
 * @author neo-cloud-agent
 * @date 2026-09-09
 */
public interface AgentStateStore {
  /**
   * Load the stored state, or a fresh empty state when the run has none yet.
   *
   * @param runId run to load
   * @return mutable state map; never null
   */
  Map<String, Object> load(String runId);

  /**
   * Replace the stored state. Implementations stamp {@code runId} and {@code updatedAt}.
   *
   * @param runId run to save
   * @param state state to persist
   */
  void save(String runId, Map<String, Object> state);
}
