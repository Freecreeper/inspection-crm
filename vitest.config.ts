import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig's "jsx": "react-jsx" is for Next; component tests need esbuild
  // to emit the automatic runtime itself.
  esbuild: { jsx: "automatic" },
  test: {
    // Node by default; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` pragma at the top of the file.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
