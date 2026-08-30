export interface CredentialStore {
  getToken(): Promise<string>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  getApiUrl(): Promise<string>;
  setApiUrl(url: string): Promise<void>;
}

const TOKEN_KEY = "neo.mobile.token";
const URL_KEY = "neo.mobile.apiUrl";

export function memoryCredentials(seed?: { token?: string; apiUrl?: string }): CredentialStore {
  let token = seed?.token ?? "";
  let apiUrl = seed?.apiUrl ?? "";
  return {
    async getToken() {
      return token;
    },
    async setToken(next) {
      token = next;
    },
    async clearToken() {
      token = "";
    },
    async getApiUrl() {
      return apiUrl;
    },
    async setApiUrl(next) {
      apiUrl = next.replace(/\/$/, "");
    },
  };
}

let sharedWebStore: CredentialStore | undefined;

/** Same instance every call. Safe as a React default argument; `webCredentials()` is not. */
export function sharedWebCredentials(): CredentialStore {
  sharedWebStore ??= webCredentials();
  return sharedWebStore;
}

export function resetSharedWebCredentials(): void {
  sharedWebStore = undefined;
}

export function webCredentials(): CredentialStore {
  return {
    async getToken() {
      return localStorage.getItem(TOKEN_KEY) ?? "";
    },
    async setToken(token) {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    },
    async clearToken() {
      localStorage.removeItem(TOKEN_KEY);
    },
    async getApiUrl() {
      return localStorage.getItem(URL_KEY) ?? "";
    },
    async setApiUrl(url) {
      const next = url.replace(/\/$/, "");
      if (next) localStorage.setItem(URL_KEY, next);
      else localStorage.removeItem(URL_KEY);
    },
  };
}
