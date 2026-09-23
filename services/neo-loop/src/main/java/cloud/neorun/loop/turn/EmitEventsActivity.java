package cloud.neorun.loop.turn;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import cloud.neorun.loop.cloud.ControlPlaneClient;
import cloud.neorun.loop.support.LinkedMaps;

/**
 * Posts RunEvents for one turn, stamping a per-turn sequence so the control plane can rewind.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class EmitEventsActivity {
  private static final int EVENT_FIELDS = 8;
  private static final int SEQUENCE_FIELDS = 2;
  private static final String ERROR_KIND = "llm.error";

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
    Map<String, Object> payload = LinkedMaps.withExpectedSize((data == null ? 0 : data.size()) + SEQUENCE_FIELDS);
    if (data != null) {
      payload.putAll(data);
    }
    payload.put("workerSeq", seq);
    payload.put("workerEpoch", turnId);
    Map<String, Object> event = LinkedMaps.withExpectedSize(EVENT_FIELDS);
    event.put("id", UUID.randomUUID().toString());
    event.put("runId", runId);
    event.put("createdAt", Instant.now().toString());
    event.put("category", "agent_run");
    event.put("level", ERROR_KIND.equals(kind) ? "error" : "info");
    event.put("kind", kind);
    event.put("title", title);
    event.put("data", payload);
    client.emitEvents(runId, List.of(event));
    return event;
  }

  public void rewind(String replyId, int fromSeq) {
    emit("turn.rewind", "Rewind streamed tokens", Map.of("replyId", replyId, "fromSeq", fromSeq));
  }

  public int seq() {
    return seq;
  }
}
