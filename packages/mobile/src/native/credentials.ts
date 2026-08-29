import * as SecureStore from "expo-secure-store";
import type { CredentialStore } from "../api/credentials";
import { DEFAULT_API_URL } from "../place";

const TOKEN_KEY = "neo.mobile.token";
const URL_KEY = "neo.mobile.apiUrl";

export function nativeCredentials(): CredentialStore {
  return {
    async getToken() {
      return (await SecureStore.getItemAsync(TOKEN_KEY)) ?? "";
    },
    async setToken(token) {
      if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    },
    async clearToken() {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    },
    async getApiUrl() {
      const stored = (await SecureStore.getItemAsync(URL_KEY)) ?? "";
      if (!stored || stored === "https://neorun.cloud" || stored === "https://neorun.cloud/") {
        return DEFAULT_API_URL;
      }
      return stored;
    },
    async setApiUrl(url) {
      const next = url.replace(/\/$/, "");
      if (next) await SecureStore.setItemAsync(URL_KEY, next);
      else await SecureStore.deleteItemAsync(URL_KEY);
    },
  };
}
