declare module "expo-speech-recognition" {
  export const ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: () => Promise<{ granted?: boolean; status?: string }>;
    start: (options: { lang: string; interimResults: boolean; continuous: boolean }) => void;
    stop: () => void;
    abort: () => void;
    addListener: (
      event: string,
      listener: (payload: { results?: Array<{ transcript?: string }>; isFinal?: boolean }) => void,
    ) => { remove: () => void };
  };
}
