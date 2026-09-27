import { IslandButton, IslandCard } from "./island";
import type { RemoteCloudContinueCopy } from "@neo-cloud-agent/contracts/desk";

type Props = {
  copy: RemoteCloudContinueCopy;
  onContinue: () => void;
};

export function RemoteOfflineCard({ copy, onContinue }: Props) {
  return (
    <IslandCard className="remote-offline-card">
      <div className="remote-offline-copy">
        <h2>{copy.title}</h2>
        {copy.repoLine ? <p className="remote-offline-meta">{copy.repoLine}</p> : null}
        <p className="remote-offline-warn">{copy.warning}</p>
      </div>
      <IslandButton id="continue-remote-cloud" type="primary" onClick={onContinue}>
        {copy.action}
      </IslandButton>
    </IslandCard>
  );
}
