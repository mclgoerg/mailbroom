import app from "../frontend/package.json" with { type: "json" };

// Release Please updates this same version for the app and website builds.
export const VERSION = app.version;
export const RELEASE_URL = `https://github.com/mclgoerg/inboxrake/releases/tag/v${VERSION}`;
