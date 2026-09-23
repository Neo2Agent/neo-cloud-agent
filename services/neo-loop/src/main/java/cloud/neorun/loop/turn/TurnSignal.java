package cloud.neorun.loop.turn;

/**
 * Abort or steer request for a live turn.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public record TurnSignal(String type, String text) {
  private static final String ABORT = "abort";
  private static final String STEER = "steer";

  public boolean abort() {
    return ABORT.equalsIgnoreCase(type);
  }

  public boolean steer() {
    return STEER.equalsIgnoreCase(type);
  }
}
