package cloud.neorun.loop.turn;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import cloud.neorun.loop.cloud.ControlPlaneClient;

public class EmitEventsActivity {
  private final ControlPlaneClient client;
  private final String runId;
  private final String turnId;
  private int seq;

  public EmitEventsActivity(ControlPlaneClient client, String runId, String turnId) {
    this.client = client;
    this.runId = runId;
    this.turnId = turnId;
  }

  public synchronized Map<String, Object> emit(String kind, String title, Map<String, Object> data) {
    seq += 1;
    Map<String, Object> payload = new LinkedHashMap<>();
    if (data != null) {
      payload.putAll(data);
    }
    payload.put("workerSeq", seq);
    payload.put("workerEpoch", turnId);
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("id", UUID.randomUUID().toString());
    event.put("runId", runId);
    event.put("createdAt", Instant.now().toString());
    event.put("category", "agent_run");
    event.put("level", "llm.error".equals(kind) ? "error" : "info");
    event.put("kind", kind);
    event.put("title", title);
    event.put("data", payload);
    client.emitEvents(runId, List.of(event));
    return event;
  }

  public void rewind(String replyId, int fromSeq) {
    emit("turn.rewind", "Rewind streamed tokens", Map.of("replyId", replyId, "fromSeq", fromSeq));
  }

  public List<Map<String, Object>> empty() {
    return new ArrayList<>();
  }

  public int seq() {
    return seq;
  }
}
