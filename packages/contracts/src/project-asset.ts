export type ProjectAssetSource = "upload" | "run";

export type ProjectAsset = {
  id: string;
  projectId: string;
  path: string;
  objectKey: string;
  size: number;
  contentType: string;
  createdBy: string;
  createdEmail: string;
  source: ProjectAssetSource;
  runId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectAssetRequest = {
  path: string;
  content: string;
  contentType?: string;
  encoding?: "utf8" | "base64";
};
