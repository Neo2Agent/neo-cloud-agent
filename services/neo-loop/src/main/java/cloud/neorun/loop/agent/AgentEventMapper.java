package cloud.neorun.loop.agent;

import java.util.Map;
import cloud.neorun.loop.turn.EmitEventsActivity;
import io.agentscope.core.event.AgentEvent;
import io.agentscope.core.event.TextBlockDeltaEvent;
import io.agentscope.core.event.TextBlockEndEvent;
import io.agentscope.core.event.ToolCallStartEvent;
import io.agentscope.core.event.ToolResultEndEvent;
import io.agentscope.core.event.ToolResultTextDeltaEvent;

/**
 * Maps AgentScope / ReAct events onto the same RunEvent kinds as
 * {@code packages/worker/src/events.ts}. Intermediate LLM-round ends are
 * {@code llm.usage} only. {@code agent.end} is emitted by the control plane
 * after {@code turn-complete}.
 */
public class AgentEventMapper {
  private final EmitEventsActivity emit;
  private final String replyId;
  private boolean messageOpen;

  public AgentEventMapper(EmitEventsActivity emit, String replyId) {
    this.emit = emit;
    this.replyId = replyId;
  }

  public void agentStart() {
    emit.emit("agent.start", "Agent turn started", Map.of("replyId", replyId));
  }

  public void textDelta(String delta) {
    if (delta == null || delta.isEmpty()) {
      return;
    }
    if (!messageOpen) {
      emit.emit("message.start", "Assistant message started", Map.of("replyId", replyId));
      messageOpen = true;
    }
    emit.emit("message.delta", "Assistant text", Map.of("delta", delta, "replyId", replyId));
  }

  public void textEnd() {
    if (messageOpen) {
      emit.emit("message.end", "Assistant message completed", Map.of("replyId", replyId));
      messageOpen = false;
    }
  }

  public void toolStart(String toolName, String toolCallId, Object args) {
    emit.emit(
        "tool.start",
        "Tool " + (toolName == null ? "unknown" : toolName),
        Map.of("toolName", toolName == null ? "" : toolName, "toolCallId", toolCallId == null ? "" : toolCallId, "args", args == null ? Map.of() : args));
  }

  public void toolUpdate(String toolName, String toolCallId, String output) {
    emit.emit(
        "tool.update",
        "Tool " + (toolName == null ? "unknown" : toolName),
        Map.of("toolName", toolName == null ? "" : toolName, "toolCallId", toolCallId == null ? "" : toolCallId, "output", output == null ? "" : output));
  }

  public void toolEnd(String toolName, String toolCallId, String output, boolean error) {
    emit.emit(
        "tool.end",
        "Tool " + (toolName == null ? "unknown" : toolName) + " finished",
        Map.of(
            "toolName",
            toolName == null ? "" : toolName,
            "toolCallId",
            toolCallId == null ? "" : toolCallId,
            "output",
            output == null ? "" : output,
            "isError",
            error));
  }

  public void usage(int promptTokens, int completionTokens) {
    if (promptTokens == 0 && completionTokens == 0) {
      return;
    }
    emit.emit(
        "llm.usage",
        "Token usage",
        Map.of("promptTokens", promptTokens, "completionTokens", completionTokens, "totalTokens", promptTokens + completionTokens));
  }

  public void emptyTurn() {
    emit.emit(
        "llm.error",
        "模型没有返回内容",
        Map.of("reason", "empty_turn"));
  }

  public void error(String message) {
    emit.emit("llm.error", "模型调用失败", Map.of("error", message == null ? "" : message));
  }

  public String replyId() {
    return replyId;
  }

  public void accept(AgentEvent event) {
    if (event instanceof TextBlockDeltaEvent delta) {
      textDelta(delta.getDelta());
      return;
    }
    if (event instanceof TextBlockEndEvent) {
      textEnd();
      return;
    }
    if (event instanceof ToolCallStartEvent start) {
      toolStart(start.getToolCallName(), start.getToolCallId(), Map.of());
      return;
    }
    if (event instanceof ToolResultTextDeltaEvent delta) {
      toolUpdate(delta.getToolCallName(), delta.getToolCallId(), delta.getDelta());
      return;
    }
    if (event instanceof ToolResultEndEvent end) {
      toolEnd(end.getToolCallName(), end.getToolCallId(), "", false);
    }
  }
}
