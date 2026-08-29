import { Platform, StatusBar } from "react-native";

/** Android draws under the status bar; RN SafeAreaView does not inset it. */
export const statusBarInset = Platform.OS === "android" ? StatusBar.currentHeight ?? 28 : 0;

export const drawerTopInset = (Platform.OS === "ios" ? 54 : statusBarInset) + 12;
