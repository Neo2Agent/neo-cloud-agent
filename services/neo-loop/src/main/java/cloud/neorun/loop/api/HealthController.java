package cloud.neorun.loop.api;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Liveness probe the control plane uses to decide whether agentscope is available.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
@RestController
public class HealthController {
  @GetMapping("/health")
  public Map<String, Object> health() {
    return Map.of("ok", true, "service", "neo-loop");
  }
}
