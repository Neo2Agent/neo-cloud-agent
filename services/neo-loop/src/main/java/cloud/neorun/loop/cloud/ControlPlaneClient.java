package cloud.neorun.loop.cloud;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;

public class ControlPlaneClient {
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
  private final ObjectMapper mapper = new ObjectMapper();
  private final String baseUrl;
  private final String jwt;

  public ControlPlaneClient(String baseUrl, String jwt) {
    this.baseUrl = trimSlash(baseUrl);
    this.jwt = jwt == null ? "" : jwt;
  }

  public void emitEvents(String runId, List<Map<String, Object>> events) {
    if (events == null || events.isEmpty()) {
      return;
    }
    post("/internal/runs/" + runId + "/events", Map.of("events", events));
  }

  public void heartbeat(String runId, String turnId, String phase, String stepId) {
    post(
        "/internal/runs/" + runId + "/turn-heartbeat",
        Map.of("turnId", turnId, "phase", phase, "stepId", stepId == null ? "" : stepId));
  }

  public void complete(String runId, String turnId, String status, String errorMessage, boolean cancelled) {
    post(
        "/internal/runs/" + runId + "/turn-complete",
        Map.of(
            "turnId",
            turnId,
            "status",
            status,
            "errorMessage",
            errorMessage == null ? "" : errorMessage,
            "cancelled",
            cancelled,
            "usage",
            Map.of("inputTokens", 0, "outputTokens", 0)));
  }

  public Map<String, Object> postCloud(String path, Map<String, Object> body) {
    return post(path, body);
  }

  public void saveSession(String runId, Map<String, Object> state) {
    post("/internal/runs/" + runId + "/loop-session", Map.of("state", state == null ? Map.of() : state));
  }

  public Map<String, Object> loadSession(String runId) {
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(baseUrl + "/internal/runs/" + runId + "/loop-session"))
              .timeout(Duration.ofSeconds(15))
              .header("authorization", "Bearer " + jwt)
              .GET()
              .build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() == 404) {
        return Map.of();
      }
      if (response.statusCode() >= 400) {
        return Map.of();
      }
      @SuppressWarnings("unchecked")
      Map<String, Object> parsed = mapper.readValue(response.body(), Map.class);
      Object state = parsed.get("state");
      if (state instanceof Map<?, ?> map) {
        @SuppressWarnings("unchecked")
        Map<String, Object> typed = (Map<String, Object>) map;
        return typed;
      }
      return Map.of();
    } catch (Exception error) {
      return Map.of();
    }
  }

  private Map<String, Object> post(String path, Map<String, Object> body) {
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(baseUrl + path))
              .timeout(Duration.ofSeconds(30))
              .header("content-type", "application/json")
              .header("authorization", "Bearer " + jwt)
              .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
              .build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() >= 400) {
        throw new IllegalStateException("control-plane " + path + " " + response.statusCode() + " " + response.body());
      }
      if (response.body() == null || response.body().isBlank()) {
        return Map.of();
      }
      @SuppressWarnings("unchecked")
      Map<String, Object> parsed = mapper.readValue(response.body(), Map.class);
      return parsed;
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("control-plane interrupted", error);
    } catch (Exception error) {
      throw new IllegalStateException("control-plane " + path + " failed", error);
    }
  }

  private static String trimSlash(String url) {
    if (url == null || url.isBlank()) {
      return "http://127.0.0.1:8080";
    }
    return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
  }
}
