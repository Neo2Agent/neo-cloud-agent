package cloud.neorun.loop.store;

import java.util.List;
import java.util.Map;

public final class SessionRestore {
  private SessionRestore() {}

  public static Map<String, Object> choose(Map<String, Object> local, Map<String, Object> remote) {
    Map<String, Object> left = local == null ? Map.of() : local;
    Map<String, Object> right = remote == null ? Map.of() : remote;
    int localCount = messageCount(left);
    int remoteCount = messageCount(right);
    if (remoteCount > localCount) {
      return right;
    }
    if (localCount > remoteCount) {
      return left;
    }
    String localAt = stringAt(left, "updatedAt");
    String remoteAt = stringAt(right, "updatedAt");
    if (!remoteAt.isEmpty() && remoteAt.compareTo(localAt) > 0) {
      return right;
    }
    return left.isEmpty() ? right : left;
  }

  private static int messageCount(Map<String, Object> state) {
    Object messages = state.get("messages");
    return messages instanceof List<?> list ? list.size() : 0;
  }

  private static String stringAt(Map<String, Object> state, String key) {
    Object value = state.get(key);
    return value == null ? "" : String.valueOf(value);
  }
}
