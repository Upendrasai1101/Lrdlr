// (tabs)/_layout.jsx
//
// Bottom tabs, in the same order as the website's sidebar:
// New lead (single entry) -> Import CSV (bulk upload) -> Dashboard.

import { Tabs } from "expo-router/tabs";
import { Text } from "react-native";
import { colors } from "../../lib/theme";

function TabIcon({ emoji, focused }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.slate },
        headerTintColor: colors.chalk,
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: colors.leafBg },
        tabBarStyle: { backgroundColor: colors.slate, borderTopColor: colors.slate },
        tabBarActiveTintColor: colors.turmeric,
        tabBarInactiveTintColor: "#b9c2b4",
        tabBarLabelStyle: { fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "🥕 New lead",
          tabBarLabel: "New lead",
          tabBarIcon: ({ focused }) => <TabIcon emoji="📝" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: "📤 Import CSV",
          tabBarLabel: "Import CSV",
          tabBarIcon: ({ focused }) => <TabIcon emoji="📤" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "📊 Dashboard",
          tabBarLabel: "Dashboard",
          tabBarIcon: ({ focused }) => <TabIcon emoji="📊" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
