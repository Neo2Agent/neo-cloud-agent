package cloud.neorun.loop.agent;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import cloud.neorun.loop.support.LinkedMaps;
import cloud.neorun.loop.turn.InferActivity;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.ChatUsage;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.Model;
import io.agentscope.core.model.ToolSchema;
import reactor.core.publisher.Flux;

/**
 * OpenAI-compatible Model that talks to llm-gateway with a run JWT. Never sees provider keys.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public class GatewayChatModel implements Model {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final TypeReference<Map<String, Object>> JSON_OBJECT = new TypeReference<>() {};
  private static final String DEFAULT_ROLE = "user";
  private static final String FINISH_STOP = "stop";
  private static final String FINISH_TOOL_CALLS = "tool_calls";
  private static final int MESSAGE_FIELDS = 2;
  private static final int FUNCTION_FIELDS = 3;

  private final InferActivity infer;
  private final String gatewayUrl;
  private final String jwt;
  private final String modelName;

  public GatewayChatModel(InferActivity infer, String gatewayUrl, String jwt, String modelName) {
    this.infer = infer;
    this.gatewayUrl = gatewayUrl;
    this.jwt = jwt;
    this.modelName = modelName;
  }

  @Override
  public Flux<ChatResponse> stream(List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
    return Flux.defer(() -> Flux.just(complete(messages, tools)));
  }

  @Override
  public String getModelName() {
    return modelName;
  }

  @Override
  public boolean supportsNativeStructuredOutput() {
    return false;
  }

  private ChatResponse complete(List<Msg> messages, List<ToolSchema> tools) {
    InferActivity.InferResult result = infer.run(gatewayUrl, jwt, modelName, toOpenAiMessages(messages), toOpenAiTools(tools));
    List<ContentBlock> blocks = new ArrayList<>(result.toolCalls().size() + 1);
    if (result.content() != null && !result.content().isBlank()) {
      blocks.add(TextBlock.builder().text(result.content()).build());
    }
    for (InferActivity.ToolCall call : result.toolCalls()) {
      blocks.add(ToolUseBlock.builder().id(call.id()).name(call.name()).input(parseArgs(call.arguments())).build());
    }
    ChatUsage usage = ChatUsage.builder().inputTokens(result.promptTokens()).outputTokens(result.completionTokens()).build();
    return ChatResponse.builder()
        .content(blocks)
        .usage(usage)
        .finishReason(result.toolCalls().isEmpty() ? FINISH_STOP : FINISH_TOOL_CALLS)
        .build();
  }

  private static List<Map<String, Object>> toOpenAiMessages(List<Msg> messages) {
    if (messages == null) {
      return new ArrayList<>();
    }
    List<Map<String, Object>> out = new ArrayList<>(messages.size());
    for (Msg msg : messages) {
      Map<String, Object> row = LinkedMaps.withExpectedSize(MESSAGE_FIELDS);
      row.put("role", msg.getRole() == null ? DEFAULT_ROLE : String.valueOf(msg.getRole()).toLowerCase());
      StringBuilder text = new StringBuilder();
      if (msg.getContent() != null) {
        for (Object block : msg.getContent()) {
          if (block instanceof TextBlock textBlock) {
            text.append(textBlock.getText());
          }
        }
      }
      row.put("content", text.toString());
      out.add(row);
    }
    return out;
  }

  private static List<Map<String, Object>> toOpenAiTools(List<ToolSchema> tools) {
    if (tools == null) {
      return new ArrayList<>();
    }
    List<Map<String, Object>> out = new ArrayList<>(tools.size());
    for (ToolSchema tool : tools) {
      Map<String, Object> fn = LinkedMaps.withExpectedSize(FUNCTION_FIELDS);
      fn.put("name", tool.getName());
      fn.put("description", tool.getDescription());
      fn.put("parameters", tool.getParameters());
      out.add(Map.of("type", "function", "function", fn));
    }
    return out;
  }

  /** Models sometimes send non-JSON arguments; pass them through as {@code raw} for the tool to reject. */
  private static Map<String, Object> parseArgs(String raw) {
    try {
      return JSON.readValue(raw, JSON_OBJECT);
    } catch (JsonProcessingException | IllegalArgumentException error) {
      return Map.of("raw", raw == null ? "" : raw);
    }
  }
}
