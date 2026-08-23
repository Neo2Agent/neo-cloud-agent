export type CredentialStore = {
  get(): string;
  set(token: string): void;
  clear(): void;
};

export function memoryCredentials(initial = ""): CredentialStore {
  let value = initial;
  return {
    get: () => value,
    set: (token) => {
      value = token;
    },
    clear: () => {
      value = "";
    },
  };
}
