export interface CloudExtension {
  name: string;
  description: string;
}

export function defineExtension(extension: CloudExtension): CloudExtension {
  return extension;
}
