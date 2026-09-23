package cloud.neorun.loop.support;

import java.util.LinkedHashMap;

/**
 * Pre-sized insertion-ordered maps, so known payload shapes never rehash.
 *
 * @author neo-cloud-agent
 * @date 2026-09-23
 */
public final class LinkedMaps {
  private static final float DEFAULT_LOAD_FACTOR = 0.75f;

  private LinkedMaps() {}

  public static <K, V> LinkedHashMap<K, V> withExpectedSize(int expectedSize) {
    return new LinkedHashMap<>((int) (expectedSize / DEFAULT_LOAD_FACTOR) + 1);
  }
}
