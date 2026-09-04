package cloud.neorun.loop.config;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "neo.loop")
public class LoopProperties {
  private String token = "";
  private String stateDir = "";
  private String engine = "harness";
  private String javaXmx = "512m";
  private long toolsWaitMs = 60_000;

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
    this.engine = engine == null || engine.isBlank() ? "harness" : engine;
  }

  public String getJavaXmx() {
    return javaXmx;
  }

  public void setJavaXmx(String javaXmx) {
    this.javaXmx = javaXmx;
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
    String fromEnv = System.getenv("NEO_LOOP_STATE_DIR");
    if (fromEnv != null && !fromEnv.isBlank()) {
      return Path.of(fromEnv);
    }
    return Path.of(".neo/runs/.loop");
  }

  public boolean tokenMatches(String presented) {
    if (token == null || token.isBlank()) {
      return true;
    }
    return token.equals(presented);
  }
}
