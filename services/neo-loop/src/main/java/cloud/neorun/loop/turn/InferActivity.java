package cloud.neorun.loop.turn;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import cloud.neorun.loop.support.LinkedMaps;

/**
 * One non-streaming chat completion against llm-gateway, retried a few times on failure.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class InferActivity {
  private static final Logger LOG = LoggerFactory.getLogger(InferActivity.class);

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(15);
  private static final Duration REQUEST_TIMEOUT = Duration.ofMinutes(3);
  private static final int MAX_ATTEMPTS = 3;
  private static final int HTTP_ERROR_MIN = 400;
  private static final int REQUEST_FIELDS = 4;
  private static final String DEFAULT_GATEWAY_URL = "http://127.0.0.1:8081";
  private static final String STEP_HEADER = "X-Neo-Step-Id";

  /**
   * One tool call requested by the model.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  public record ToolCall(String id, String name, String arguments) {}

  /**
   * Parsed completion plus the raw body for the step log.
   *
   * @author neo-cloud-agent
   * @date 2026-09-04
   */
  public record InferResult(String content, List<ToolCall> toolCalls, int promptTokens, int completionTokens, String raw) {}

  private final HttpClient http = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
  private final ObjectMapper mapper = new ObjectMapper();

  public InferResult run(String gatewayUrl, String jwt, String model, List<Map<String, Object>> messages, List<Map<String, Object>> tools) {
    return run(gatewayUrl, jwt, model, messages, tools, null);
  }

  public InferResult run(
      String gatewayUrl,
      String jwt,
      String model,
      List<Map<String, Object>> messages,
      List<Map<String, Object>> tools,
      String stepId) {
    RuntimeException last = null;
    for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return runOnce(gatewayUrl, jwt, model, messages, tools, stepId);
      } catch (RuntimeException error) {
        LOG.warn("infer attempt {}/{} failed for step {}", attempt, MAX_ATTEMPTS, stepId, error);
        last = error;
      }
    }
    throw last;
  }

  private InferResult runOnce(
      String gatewayUrl,
      String jwt,
      String model,
      List<Map<String, Object>> messages,
      List<Map<String, Object>> tools,
      String stepId) {
    try {
      Map<String, Object> body = LinkedMaps.withExpectedSize(REQUEST_FIELDS);
      body.put("model", model);
      body.put("messages", messages);
      body.put("stream", false);
      if (tools != null && !tools.isEmpty()) {
        body.put("tools", tools);
      }
      HttpRequest.Builder builder =
          HttpRequest.newBuilder(URI.create(trimSlash(gatewayUrl) + "/v1/chat/completions"))
              .timeout(REQUEST_TIMEOUT)
              .header("content-type", "application/json")
              .header("authorization", "Bearer " + jwt);
      if (stepId != null && !stepId.isBlank()) {
        builder.header(STEP_HEADER, stepId);
      }
      HttpRequest request = builder.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() >= HTTP_ERROR_MIN) {
        throw new IllegalStateException("gateway " + response.statusCode() + " " + response.body());
      }
      JsonNode root = mapper.readTree(response.body());
      JsonNode message = root.path("choices").path(0).path("message");
      String content = message.path("content").asText("");
      List<ToolCall> calls = new ArrayList<>();
      JsonNode toolCalls = message.path("tool_calls");
      if (toolCalls.isArray()) {
        for (JsonNode call : toolCalls) {
          calls.add(
              new ToolCall(
                  call.path("id").asText(), call.path("function").path("name").asText(), call.path("function").path("arguments").asText("{}")));
        }
      }
      JsonNode usage = root.path("usage");
      return new InferResult(content, calls, usage.path("prompt_tokens").asInt(0), usage.path("completion_tokens").asInt(0), response.body());
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("infer interrupted", error);
    } catch (IllegalStateException error) {
      throw error;
    } catch (Exception error) {
      throw new IllegalStateException("infer failed", error);
    }
  }

  private static String trimSlash(String url) {
    if (url == null || url.isBlank()) {
      return DEFAULT_GATEWAY_URL;
    }
    return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
  }
}
