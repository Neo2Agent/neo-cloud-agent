import * as SecureStore from "expo-secure-store";
import type { CredentialStore } from "../api/credentials";
import { canonicalApiUrl } from "../place";

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
      const next = canonicalApiUrl(stored);
      if (stored && stored.replace(/\/$/, "") !== next) {
        await SecureStore.setItemAsync(URL_KEY, next);
      }
      return next;
    },
    async setApiUrl(url) {
      const trimmed = url.replace(/\/$/, "");
      if (!trimmed) {
        await SecureStore.deleteItemAsync(URL_KEY);
        return;
      }
      await SecureStore.setItemAsync(URL_KEY, canonicalApiUrl(trimmed));
    },
  };
}
