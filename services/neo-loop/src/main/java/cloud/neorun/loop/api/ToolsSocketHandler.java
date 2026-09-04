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

@Component
public class ToolsSocketHandler extends TextWebSocketHandler {
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
    session.sendMessage(new TextMessage(mapper.writeValueAsString(ToolsFrame.hello(runId, "/workspace"))));
  }

  @Override
  protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
    Map<String, Object> frame = mapper.readValue(message.getPayload(), new TypeReference<>() {});
    hub.onFrame(runId(session), frame);
  }

  @Override
  public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    hub.detach(runId(session), session);
  }

  private boolean authorized(WebSocketSession session) {
    if (properties.getToken() == null || properties.getToken().isBlank()) {
      return true;
    }
    String query = session.getUri() == null ? "" : session.getUri().getQuery();
    if (query != null && query.contains("token=" + properties.getToken())) {
      return true;
    }
    String header = session.getHandshakeHeaders().getFirst("Authorization");
    return header != null && header.equals("Bearer " + properties.getToken());
  }

  private static String runId(WebSocketSession session) {
    String path = session.getUri() == null ? "" : session.getUri().getPath();
    int slash = path.lastIndexOf('/');
    return slash < 0 ? "" : path.substring(slash + 1);
  }
}
