import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.mjs"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "coverage",
      include: ["shared/**/*.cjs", "server/**/*.cjs"],
      exclude: [
        "server-publish/**",
        "release/**",
        "dist/**",
        "coverage/**",
        "node_modules/**"
      ]
    }
  }
});
