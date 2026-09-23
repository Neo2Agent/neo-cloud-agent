package cloud.neorun.loop.turn;

/**
 * Runs one user turn at a time per run id and accepts abort / steer signals while it is live.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public interface TurnWorkflowEngine {
  /**
   * Accept a turn and run it asynchronously. The control plane learns the outcome from turn-complete.
   *
   * @param cmd turn input from the control plane
   * @return handle echoing the accepted run and turn ids
   */
  TurnHandle start(StartTurnCommand cmd);

  /**
   * Abort or steer a live turn.
   *
   * @param turnId turn to signal
   * @param signal abort or steer, with steer text
   * @throws IllegalStateException when the turn is not live on this host
   */
  void signal(String turnId, TurnSignal signal);
}
