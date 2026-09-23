package cloud.neorun.loop.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Choosing between the local file and control-plane session copies.
 *
 * @author neo-cloud-agent
 * @date 2026-09-10
 */
class SessionRestoreTest {
  @Test
  void prefersRemoteWhenItHasMoreMessages() {
    Map<String, Object> chosen =
        SessionRestore.choose(
            Map.of("messages", List.of(), "updatedAt", "2026-09-10T00:00:00Z"),
            Map.of("messages", List.of(Map.of("role", "user")), "updatedAt", "2026-09-09T00:00:00Z"));
    assertEquals(1, ((List<?>) chosen.get("messages")).size());
  }

  @Test
  void prefersNewerRemoteWhenMessageCountsMatch() {
    Map<String, Object> chosen =
        SessionRestore.choose(
            Map.of("messages", List.of(Map.of("role", "user")), "updatedAt", "2026-09-10T00:00:00Z"),
            Map.of("messages", List.of(Map.of("role", "assistant")), "updatedAt", "2026-09-11T00:00:00Z"));
    assertEquals("assistant", ((Map<?, ?>) ((List<?>) chosen.get("messages")).getFirst()).get("role"));
  }
}
