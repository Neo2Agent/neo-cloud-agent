import { remoteCloudContinueCopy } from "@neo-cloud-agent/contracts/desk";

type Props = {
  remoteUrl: string;
  branch: string;
  error?: string;
  onContinue: () => void;
};

export function RemoteOfflineCard({ remoteUrl, branch, error, onContinue }: Props) {
  const copy = remoteCloudContinueCopy({ remoteUrl, branch });
  return (
    <aside className="remote-offline-card" id="remote-offline-card" aria-label={copy.title}>
      <div className="remote-offline-copy">
        <h2>{copy.title}</h2>
        {copy.repoLine ? <p className="remote-offline-meta">{copy.repoLine}</p> : null}
        <p className="remote-offline-warn">{copy.warning}</p>
      </div>
      <div className="remote-offline-actions">
        <button type="button" id="continue-remote-cloud" className="remote-offline-go" onClick={onContinue}>
          {copy.action}
        </button>
      </div>
      {error ? <p className="remote-offline-err">{error}</p> : null}
    </aside>
  );
}
