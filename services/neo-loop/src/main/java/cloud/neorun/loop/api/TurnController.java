package cloud.neorun.loop.api;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import cloud.neorun.loop.turn.TurnHandle;
import cloud.neorun.loop.turn.TurnSignal;
import cloud.neorun.loop.turn.TurnSnapshot;
import cloud.neorun.loop.turn.TurnWorkflowEngine;

@RestController
public class TurnController {
  private final TurnWorkflowEngine engine;

  public TurnController(TurnWorkflowEngine engine) {
    this.engine = engine;
  }

  @PostMapping("/internal/loop/turns")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public TurnDtos.StartTurnResponse start(@RequestBody TurnDtos.StartTurnRequest body) {
    if (body.runId() == null || body.turnId() == null) {
      throw new IllegalArgumentException("runId and turnId are required");
    }
    TurnHandle handle = engine.start(body.toCommand());
    return new TurnDtos.StartTurnResponse(handle.turnId(), handle.runId(), handle.accepted());
  }

  @PostMapping("/internal/loop/turns/{turnId}/signal")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public TurnDtos.StartTurnResponse signal(@PathVariable String turnId, @RequestBody TurnDtos.SignalRequest body) {
    engine.signal(turnId, new TurnSignal(body.type(), body.text(), body.followUpId()));
    return new TurnDtos.StartTurnResponse(turnId, "", true);
  }

  @GetMapping("/internal/loop/turns/{turnId}")
  public TurnSnapshot query(@PathVariable String turnId) {
    return engine.query(turnId);
  }
}
