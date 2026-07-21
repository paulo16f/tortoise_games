import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/test/**/*.test.ts"],
    environment: "node",
    // DB-backed tests read TEST_DATABASE_URL and skip themselves when absent.
    // They share one database, so files must not run concurrently.
    fileParallelism: false,
  },
});
