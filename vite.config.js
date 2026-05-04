import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveBuildVersion() {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

  try {
    const commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();

    return `v${pkg.version}+${commit}`;
  } catch {
    return `v${pkg.version}`;
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveBuildVersion()),
  },
});
