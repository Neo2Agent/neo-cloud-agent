package cloud.neorun.loop.turn;

import static org.junit.jupiter.api.Assertions.assertTrue;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.sun.net.httpserver.HttpServer;
import cloud.neorun.loop.config.LoopProperties;
import cloud.neorun.loop.sandbox.ToolsHub;

/**
 * End-to-end ReAct turn against local mock gateway and control plane.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
class LocalTurnEngineTest {
  private static final long TURN_COMPLETE_TIMEOUT_SECONDS = 15L;

  @TempDir Path temp;

  @Test
  void activityLoopReachesTurnCompleteAgainstMockGateway() throws Exception {
    List<String> completes = new ArrayList<>();
    CountDownLatch done = new CountDownLatch(1);
    HttpServer gateway = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    gateway.createContext(
        "/v1/chat/completions",
        exchange -> {
          byte[] body =
              """
              {"id":"cmpl-1","choices":[{"message":{"role":"assistant","content":"hello from neo-loop"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":5}}
              """
                  .getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("content-type", "application/json");
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    gateway.start();
    HttpServer control = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    control.createContext(
        "/",
        exchange -> {
          String path = exchange.getRequestURI().getPath();
          byte[] ignored = exchange.getRequestBody().readAllBytes();
          if (path.endsWith("/turn-complete")) {
            completes.add(new String(ignored, StandardCharsets.UTF_8));
            done.countDown();
          }
          byte[] ok = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(202, ok.length);
          exchange.getResponseBody().write(ok);
          exchange.close();
        });
    control.start();
    try {
      LoopProperties properties = new LoopProperties();
      properties.setStateDir(temp.toString());
      properties.setEngine("react");
      properties.setToolsWaitMs(200);
      LocalTurnEngine engine = new LocalTurnEngine(new ToolsHub(), properties);
      StartTurnCommand cmd =
          new StartTurnCommand(
              "run-1",
              "turn-1",
              "user",
              "prompt",
              "say hello",
              "neo/deepseek",
              "jwt",
              "http://127.0.0.1:" + gateway.getAddress().getPort(),
              "http://127.0.0.1:" + control.getAddress().getPort(),
              new StartTurnCommand.ToolsBinding("skip", "/workspace"),
              new StartTurnCommand.WorkspaceContext("# toy", null, null));
      engine.start(cmd);
      assertTrue(done.await(TURN_COMPLETE_TIMEOUT_SECONDS, TimeUnit.SECONDS), "turn-complete was not posted");
      assertTrue(completes.getFirst().contains("\"status\":\"idle\""));
      assertTrue(Files.exists(temp.resolve("turns").resolve("turn-1.jsonl")));
      assertTrue(Files.exists(temp.resolve("sessions").resolve("run-1.json")));
    } finally {
      gateway.stop(0);
      control.stop(0);
    }
  }
}
