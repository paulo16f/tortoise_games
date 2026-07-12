// Cooking recipes — a gold-free sink that turns raw fish into cooked food that
// out-heals bread. Pure data + a byId lookup, mirroring dailyQuests.ts / skins.ts.
// The server (ZoneRoom.craftRecipe) is the only place a recipe is executed; the
// client uses this table to render the cooking panel and check ingredient counts.
// Higher tiers cost more raw material, so cooking scales as a resource sink.

export interface CookingRecipe {
  id: string;
  /** Item id produced. */
  output: string;
  outputCount: number;
  /** Ingredients consumed from the bag. */
  inputs: { itemId: string; count: number }[];
}

export const COOKING_RECIPES: readonly CookingRecipe[] = [
  { id: "cook_minnow", output: "cooked_minnow", outputCount: 1, inputs: [{ itemId: "raw_minnow", count: 2 }] },
  { id: "cook_cavefish", output: "cooked_cavefish", outputCount: 1, inputs: [{ itemId: "raw_cavefish", count: 2 }] },
  {
    id: "cook_bass",
    output: "grilled_bass",
    outputCount: 1,
    inputs: [
      { itemId: "raw_gilded_bass", count: 1 },
      { itemId: "raw_cavefish", count: 2 },
    ],
  },
];

export function cookingRecipe(id: string): CookingRecipe | undefined {
  return COOKING_RECIPES.find((r) => r.id === id);
}
