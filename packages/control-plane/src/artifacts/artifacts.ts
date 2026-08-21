export interface ArtifactUpload {
  name: string;
  contentType: string;
  sizeBytes: number;
  url: string;
}

/** Control plane signs an upload URL; the VM PUTs bytes to object storage. */
export function signUpload(input: {
  runId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}): ArtifactUpload {
  return {
    name: input.name,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    url: `/dev-artifacts/${input.runId}/${encodeURIComponent(input.name)}`,
  };
}
