// Landing-page switches and links, in one place.

// The "Try the demo" button is only built when the demo is live: the deploy
// step sets INBOXRAKE_DEMO_LIVE=1. Off by default, so no dead /demo/ link
// ships in the HTML.
export const DEMO_LIVE = process.env.INBOXRAKE_DEMO_LIVE === "1";

export const GITHUB = "https://github.com/mclgoerg/inboxrake";
