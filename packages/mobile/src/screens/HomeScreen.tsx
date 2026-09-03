import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BUNDLED_RECIPES, type Recipe } from "@neo-cloud-agent/contracts/recipe";
import { dayGreeting } from "../island-theme";
import { colors } from "./theme";

export function HomeScreen({ expertName, onPickRecipe }: { expertName?: string; onPickRecipe?: (recipe: Recipe) => void }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.hello}>{dayGreeting()}，今天想做点什么</Text>
      <Text style={styles.hint}>{expertName ? `已选专家 ${expertName}` : "新开一条云端对话，或从左边打开已有任务。"}</Text>
      {onPickRecipe ? (
        <ScrollView style={styles.recipes} contentContainerStyle={styles.recipeBody}>
          {BUNDLED_RECIPES.map((item) => (
            <Pressable key={item.id} style={styles.recipe} onPress={() => onPickRecipe(item)}>
              <Text style={styles.recipeTitle}>{item.title}</Text>
              <Text style={styles.recipeHint}>{item.description}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hello: { fontSize: 22, fontWeight: "700", color: colors.ink, textAlign: "center" },
  hint: { color: colors.muted, marginTop: 8, textAlign: "center" },
  recipes: { alignSelf: "stretch", marginTop: 18, maxHeight: 260 },
  recipeBody: { gap: 8, paddingBottom: 8 },
  recipe: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  recipeTitle: { color: colors.ink, fontWeight: "700" },
  recipeHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
