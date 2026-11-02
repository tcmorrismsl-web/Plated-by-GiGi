// Plated by GiGi settings.
// The Firebase web config is safe to publish: it only identifies the project.
// Access is locked by the Firestore rules (see firestore.rules), which allow
// only the family's Google accounts.
window.PLATED_CONFIG = {
  firebase: {
    apiKey: "PASTE_FROM_FIREBASE",
    authDomain: "PASTE_FROM_FIREBASE",
    projectId: "PASTE_FROM_FIREBASE",
    storageBucket: "PASTE_FROM_FIREBASE",
    messagingSenderId: "PASTE_FROM_FIREBASE",
    appId: "PASTE_FROM_FIREBASE"
  },
  // Everyone signed in shares this one recipe box and grocery list.
  household: "gigi",
  // Model used to read recipe cards and pasted recipes (needs a Claude API key, added in the app's settings).
  claudeModel: "claude-sonnet-5-5"
};
