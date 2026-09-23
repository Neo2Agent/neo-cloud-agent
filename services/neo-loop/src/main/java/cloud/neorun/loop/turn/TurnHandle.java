package cloud.neorun.loop.turn;

/**
 * Acknowledgement returned when a turn is accepted.
 *
 * @author neo-cloud-agent
 * @date 2026-09-04
 */
public record TurnHandle(String turnId, String runId, boolean accepted) {}
