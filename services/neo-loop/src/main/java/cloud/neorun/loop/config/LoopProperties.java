package cloud.neorun.loop.config;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code neo.loop.*} settings. JVM heap is set by the systemd unit, not here.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
@ConfigurationProperties(prefix = "neo.loop")
public class LoopProperties {
  private static final String DEFAULT_ENGINE = "harness";
  private static final long DEFAULT_TOOLS_WAIT_MS = 60_000L;
  private static final String STATE_DIR_ENV = "NEO_LOOP_STATE_DIR";
  private static final String DEFAULT_STATE_DIR = ".neo/runs/.loop";

  private String token = "";
  private String stateDir = "";
  private String engine = DEFAULT_ENGINE;
  private long toolsWaitMs = DEFAULT_TOOLS_WAIT_MS;

  public String getToken() {
    return token;
  }

  public void setToken(String token) {
    this.token = token == null ? "" : token;
  }

  public String getStateDir() {
    return stateDir;
  }

  public void setStateDir(String stateDir) {
    this.stateDir = stateDir == null ? "" : stateDir;
  }

  public String getEngine() {
    return engine;
  }

  public void setEngine(String engine) {
    this.engine = engine == null || engine.isBlank() ? DEFAULT_ENGINE : engine;
  }

  public long getToolsWaitMs() {
    return toolsWaitMs;
  }

  public void setToolsWaitMs(long toolsWaitMs) {
    this.toolsWaitMs = toolsWaitMs;
  }

  public Path resolveStateDir() {
    if (stateDir != null && !stateDir.isBlank()) {
      return Path.of(stateDir);
    }
    String fromEnv = System.getenv(STATE_DIR_ENV);
    if (fromEnv != null && !fromEnv.isBlank()) {
      return Path.of(fromEnv);
    }
    return Path.of(DEFAULT_STATE_DIR);
  }

  public boolean tokenMatches(String presented) {
    if (token == null || token.isBlank()) {
      return true;
    }
    return token.equals(presented);
  }
}
