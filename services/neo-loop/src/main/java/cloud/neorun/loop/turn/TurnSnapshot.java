package cloud.neorun.loop.turn;

public record TurnSnapshot(String turnId, String runId, String phase, String stepId, String startedAt) {}
