package cloud.neorun.loop;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import cloud.neorun.loop.config.LoopProperties;

/**
 * neo-loop entry point: the optional AgentScope kernel behind {@code AGENT_KERNEL=agentscope}.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
@SpringBootApplication
@EnableConfigurationProperties(LoopProperties.class)
public class LoopApplication {
  public static void main(String[] args) {
    SpringApplication.run(LoopApplication.class, args);
  }
}
