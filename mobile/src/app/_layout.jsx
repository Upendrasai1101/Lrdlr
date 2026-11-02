// _layout.jsx (root)
//
// The app's frame. The two tabs (New lead, Leads) live in the (tabs) group;
// the Lead detail screen (step 3) will open on top of them.

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "../lib/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.slate },
          headerTintColor: colors.chalk,
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: colors.leafBg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}