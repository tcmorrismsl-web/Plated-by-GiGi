# Plated w/ GiGi

A family recipe box for two phones. Save recipes from websites, photos of recipe cards, or AI chats; scale them to the pan you're using; and build a shared grocery list to shop at Harris Teeter or Walmart.

- **Hosting:** GitHub Pages (this repo). No build step: plain HTML, CSS and JavaScript.
- **Shared data:** Firebase Firestore, with Google sign-in. Only the Google accounts listed in `firestore.rules` can read or change anything.
- **Recipe cards:** copy the card's words with iPhone Live Text and paste them; Plated sorts the lines into ingredients and steps for free. An optional Claude API key (Settings, per phone) adds photo upload and smarter reading.

## One-time setup

### 1. Firebase (free plan)
1. Go to [console.firebase.google.com](https://console.firebase.google.com) and add a project (`plated-by-gigi`). Google Analytics can be off.
2. On the project home, click the web icon `</>`, register an app, and copy the `firebaseConfig` values into `config.js`.
3. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
4. **Authentication → Settings → Authorized domains → Add domain:** `tcmorrismsl-web.github.io`
5. **Build → Firestore Database → Create database.** Choose production mode and a US location.
6. **Firestore Database → Rules:** paste the contents of `firestore.rules`, put your two Google email addresses in the list, and click **Publish**.

### 2. GitHub Pages
Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**. The site appears at `https://tcmorrismsl-web.github.io/Plated-by-GiGi/` within a minute or two.

### 3. On each phone
1. Open the site in Safari and sign in with Google.
2. **Share → Add to Home Screen** to get the Plated icon.
3. Optional: tap the round account button (top right) → paste a Claude API key from [console.anthropic.com](https://console.anthropic.com) to add photo upload. Not needed for Live Text, websites or AI chats. API use is billed to that Anthropic account, separately from any Claude subscription.

## Adding someone later
Add their email address to the list in the Firestore rules and publish. Nothing in this repo needs to change.

## Files
| File | What it is |
| --- | --- |
| `index.html` | Page shell |
| `app.js` | The app: recipes, scaling, grocery list, sign-in, sync |
| `styles.css` | Look and layout (light and dark) |
| `config.js` | Firebase settings and the Claude model name |
| `firestore.rules` | Who can access the data (paste into the Firebase console) |
| `manifest.webmanifest`, `*.png` | Home-screen app name and icons |

## Notes
- The Firebase web config in `config.js` isn't a secret. It only says which project to talk to. The Firestore rules are what keep the data private.
- Never commit a Claude API key to this repo. The app keeps it in the phone's browser storage only.
- Neither Harris Teeter's nor Walmart's app accepts an imported list file. Plated's "Find at …" links open each store's own search for an item, and the list can be copied, shared, or saved as .csv/.txt.
