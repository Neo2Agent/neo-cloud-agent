/**
 * Expo shell. Vite :5175 is the DOM visual lab in src/web.
 * This entry is login / home / list / chat against the same /v1 client.
 */
import { StatusBar } from "expo-status-bar";
import { NativeApp } from "./src/screens/NativeApp";
import { nativeCredentials } from "./src/native/credentials";

const store = nativeCredentials();

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <NativeApp store={store} />
    </>
  );
}
