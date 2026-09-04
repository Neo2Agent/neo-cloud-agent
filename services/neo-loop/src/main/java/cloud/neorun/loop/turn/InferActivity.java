package cloud.neorun.loop.turn;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

public class InferActivity {
  public record ToolCall(String id, String name, String arguments) {}

  public record InferResult(String content, List<ToolCall> toolCalls, int promptTokens, int completionTokens, String raw) {}

  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
  private final ObjectMapper mapper = new ObjectMapper();

  public InferResult run(String gatewayUrl, String jwt, String model, List<Map<String, Object>> messages, List<Map<String, Object>> tools) {
    try {
      Map<String, Object> body = new LinkedHashMap<>();
      body.put("model", model);
      body.put("messages", messages);
      body.put("stream", false);
      if (tools != null && !tools.isEmpty()) {
        body.put("tools", tools);
      }
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(trimSlash(gatewayUrl) + "/v1/chat/completions"))
              .timeout(Duration.ofMinutes(3))
              .header("content-type", "application/json")
              .header("authorization", "Bearer " + jwt)
              .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
              .build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() >= 400) {
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
                  call.path("id").asText(),
                  call.path("function").path("name").asText(),
                  call.path("function").path("arguments").asText("{}")));
        }
      }
      JsonNode usage = root.path("usage");
      return new InferResult(
          content,
          calls,
          usage.path("prompt_tokens").asInt(0),
          usage.path("completion_tokens").asInt(0),
          response.body());
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("infer interrupted", error);
    } catch (Exception error) {
      throw new IllegalStateException("infer failed", error);
    }
  }

  private static String trimSlash(String url) {
    if (url == null || url.isBlank()) {
      return "http://127.0.0.1:8081";
    }
    return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
  }
}
