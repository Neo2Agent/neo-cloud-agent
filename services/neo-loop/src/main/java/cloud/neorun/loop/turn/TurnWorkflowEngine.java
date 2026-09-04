package cloud.neorun.loop.turn;

public interface TurnWorkflowEngine {
  TurnHandle start(StartTurnCommand cmd);

  void signal(String turnId, TurnSignal signal);

  TurnSnapshot query(String turnId);
}
