import type { NextConfig } from "next";

/**
 * Identifies the build to the client, so the service worker can be registered
 * at a URL that changes when the app does.
 *
 * A service worker is only replaced when its own bytes change. sw.js is static
 * and identical between deploys, so the browser compared it, found no
 * difference, and never installed a new one — which meant `activate` never ran
 * and the cache it clears was never cleared. An installed app could sit on a
 * complete, working, months-old build.
 *
 * The commit sha where Vercel provides it; a timestamp locally, where every
 * build is a new one anyway.
 */
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? Date.now().toString(36);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
};

export default nextConfig;
