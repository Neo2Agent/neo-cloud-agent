package cloud.neorun.loop.cloud;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Loop → control-plane calls on {@code /internal/runs/:id/*}, authenticated with the run JWT.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class ControlPlaneClient {
  private static final Logger LOG = LoggerFactory.getLogger(ControlPlaneClient.class);

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);
  private static final Duration LOAD_TIMEOUT = Duration.ofSeconds(15);
  private static final Duration POST_TIMEOUT = Duration.ofSeconds(30);
  private static final int HTTP_NOT_FOUND = 404;
  private static final int HTTP_ERROR_MIN = 400;
  private static final String DEFAULT_BASE_URL = "http://127.0.0.1:8080";
  private static final TypeReference<Map<String, Object>> JSON_OBJECT = new TypeReference<>() {};

  // Node's control-plane is HTTP/1.1. The default Java client speaks HTTP/2 first
  // and the first heartbeat then fails, leaving the Desk UI stuck on 正在思考.
  private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(CONNECT_TIMEOUT).build();
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
    post("/internal/runs/" + runId + "/turn-heartbeat", Map.of("turnId", turnId, "phase", phase, "stepId", stepId == null ? "" : stepId));
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

  /** Empty map when there is no stored session or the control plane cannot be reached. */
  public Map<String, Object> loadSession(String runId) {
    String path = "/internal/runs/" + runId + "/loop-session";
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(LOAD_TIMEOUT).header("authorization", "Bearer " + jwt).GET().build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() == HTTP_NOT_FOUND) {
        return Map.of();
      }
      if (response.statusCode() >= HTTP_ERROR_MIN) {
        LOG.warn("control-plane {} returned {}; starting without a stored session", path, response.statusCode());
        return Map.of();
      }
      Object state = mapper.readValue(response.body(), JSON_OBJECT).get("state");
      if (state instanceof Map<?, ?> map) {
        @SuppressWarnings("unchecked")
        Map<String, Object> typed = (Map<String, Object>) map;
        return typed;
      }
      return Map.of();
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      LOG.warn("control-plane {} interrupted", path, error);
      return Map.of();
    } catch (IOException | IllegalArgumentException error) {
      LOG.warn("control-plane {} unreachable; starting without a stored session", path, error);
      return Map.of();
    }
  }

  private Map<String, Object> post(String path, Map<String, Object> body) {
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(baseUrl + path))
              .timeout(POST_TIMEOUT)
              .header("content-type", "application/json")
              .header("authorization", "Bearer " + jwt)
              .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
              .build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() >= HTTP_ERROR_MIN) {
        throw new IllegalStateException("control-plane " + path + " " + response.statusCode() + " " + response.body());
      }
      if (response.body() == null || response.body().isBlank()) {
        return Map.of();
      }
      return mapper.readValue(response.body(), JSON_OBJECT);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("control-plane interrupted", error);
    } catch (IOException | IllegalArgumentException error) {
      throw new IllegalStateException("control-plane " + path + " failed", error);
    }
  }

  private static String trimSlash(String url) {
    if (url == null || url.isBlank()) {
      return DEFAULT_BASE_URL;
    }
    return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
  }
}
