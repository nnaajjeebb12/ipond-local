import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted on a Raspberry Pi, not Vercel. "standalone" emits
  // .next/standalone/server.js with only the traced runtime deps, so the Pi
  // does not need node_modules or a build toolchain to serve the app.
  output: "standalone",

  // pg ships native bindings; keep it external so tracing does not try to
  // bundle it into the standalone output.
  serverExternalPackages: ["pg", "pg-native"],
};

export default nextConfig;
