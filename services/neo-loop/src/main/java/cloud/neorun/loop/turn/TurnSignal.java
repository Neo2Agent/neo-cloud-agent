package cloud.neorun.loop.turn;

public record TurnSignal(String type, String text, String followUpId) {
  public boolean abort() {
    return "abort".equalsIgnoreCase(type);
  }

  public boolean steer() {
    return "steer".equalsIgnoreCase(type);
  }
}
