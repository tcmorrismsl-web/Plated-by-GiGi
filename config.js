// Plated w/ GiGi settings.
// The Firebase web config is safe to publish: it only identifies the project.
// Access is locked by the Firestore rules (see firestore.rules), which allow
// only the family's Google accounts.
window.PLATED_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBCCjWYVImenpP6E2LKhEYp07O4JMtFKjA",
    authDomain: "plated-by-gigi.firebaseapp.com",
    projectId: "plated-by-gigi",
    storageBucket: "plated-by-gigi.firebasestorage.app",
    messagingSenderId: "526953969964",
    appId: "1:526953969964:web:0003472c9604573468d489"
  },
  // Everyone signed in shares this one recipe box and grocery list.
  household: "gigi",
  // Model used to read recipe cards and pasted recipes (needs a Claude API key, added in the app's settings).
  claudeModel: "claude-sonnet-5-5"
};
