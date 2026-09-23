package cloud.neorun.loop.api;

import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import cloud.neorun.loop.config.LoopProperties;
import cloud.neorun.loop.sandbox.ToolsFrame;
import cloud.neorun.loop.sandbox.ToolsHub;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Accepts the worker's tools WebSocket at {@code /internal/tools/{runId}} and hands frames to
 * {@link ToolsHub}.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
@Component
public class ToolsSocketHandler extends TextWebSocketHandler {
  private static final String DEFAULT_SANDBOX_ROOT = "/workspace";
  private static final String BEARER_PREFIX = "Bearer ";
  private static final String TOKEN_QUERY = "token=";
  private static final TypeReference<Map<String, Object>> JSON_OBJECT = new TypeReference<>() {};

  private final ToolsHub hub;
  private final LoopProperties properties;
  private final ObjectMapper mapper = new ObjectMapper();

  public ToolsSocketHandler(ToolsHub hub, LoopProperties properties) {
    this.hub = hub;
    this.properties = properties;
  }

  @Override
  public void afterConnectionEstablished(WebSocketSession session) throws Exception {
    if (!authorized(session)) {
      session.close(CloseStatus.NOT_ACCEPTABLE.withReason("unauthorized"));
      return;
    }
    String runId = runId(session);
    hub.attach(runId, session);
    session.sendMessage(new TextMessage(mapper.writeValueAsString(ToolsFrame.hello(runId, DEFAULT_SANDBOX_ROOT))));
  }

  @Override
  protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
    hub.onFrame(runId(session), mapper.readValue(message.getPayload(), JSON_OBJECT));
  }

  @Override
  public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    hub.detach(runId(session), session);
  }

  private boolean authorized(WebSocketSession session) {
    String token = properties.getToken();
    if (token == null || token.isBlank()) {
      return true;
    }
    String query = session.getUri() == null ? "" : session.getUri().getQuery();
    if (query != null && query.contains(TOKEN_QUERY + token)) {
      return true;
    }
    return (BEARER_PREFIX + token).equals(session.getHandshakeHeaders().getFirst("Authorization"));
  }

  private static String runId(WebSocketSession session) {
    String path = session.getUri() == null ? "" : session.getUri().getPath();
    int slash = path.lastIndexOf('/');
    return slash < 0 ? "" : path.substring(slash + 1);
  }
}
