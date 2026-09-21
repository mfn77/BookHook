# BookHook — Android (native, Kotlin + Jetpack Compose)

A from-scratch native Android app that talks to the **same Firebase project** as the web app
(`bookhook-77`) — same `users`, `days/*/answers`, `posts` collections, same accounts, same data.
The web app (`/index.html`) and its live deployment are completely untouched by anything in this
folder; this is a separate, additive app.

This first version is intentionally small — it covers the core loop only:

- **Auth**: email/password sign in and sign up (writes the same `users/{uid}` profile shape the
  web app writes at signup).
- **Bugün (Check-in)**: mark "Okudum" / "Okumadım" for today, and see who else has marked today.
  Mirrors `index.html`'s `markStatus()` exactly, including the toggle-off-if-tapped-again
  behavior and the "logical day rolls over at 06:00, not midnight" rule (`util/LogicalDay.kt`).
- **Akış (Feed)**: read the latest posts and publish a simple text post.

Everything else the web app does (lottery, gift books, discover, badges, quarterly pick, push
notifications, admin tools, ...) is **not** ported yet — this is meant as a working skeleton to
validate the approach and the look/feel before sinking time into the rest. The UI/layout/navigation
is entirely up to you from here — nothing about it is tied to the web app's design.

## ⚠️ I could not compile or run this here

This session has no Android SDK, and the sandbox's network policy blocks `dl.google.com` (where
the SDK components live), so `gradle build` can't succeed in this environment — I verified that
directly rather than guessing. I wrote every file by hand against APIs I'm confident about, but
**you are the first real compiler this code will see.** Open it in Android Studio and let it sync;
if anything doesn't compile, tell me the error and I'll fix it — that's a normal, expected step,
not a sign something is fundamentally wrong.

## One-time setup

1. **Register the Android app in Firebase Console** (project `bookhook-77`, the same one
   `index.html` uses):
   - Project settings → Add app → Android.
   - Package name: **`tr.bookhook.app`** (must match `applicationId` in `app/build.gradle.kts`
     exactly, or the app won't be able to authenticate).
   - Debug/release signing SHA-1 isn't required yet (only needed later for Google Sign-In).
   - Download the generated **`google-services.json`** and place it at `android/app/google-services.json`
     (that path is git-ignored on purpose — it's per-project config, not something to commit blindly).

2. **Open the `android/` folder in Android Studio** (not the repo root — `android/` is its own
   Gradle project). Let it sync; first sync will download the Android SDK components, Gradle
   distribution, and all dependencies (Compose, Firebase, Navigation) from Google's/Maven's
   repositories, which is why it has to happen on your machine rather than here.

3. Run it on an emulator or device. Sign up with a new account (or sign in with an existing
   BookHook member's email/password — it's the same user database as the web app).

## Project layout

```
android/
├── app/
│   ├── build.gradle.kts        App module: applicationId, SDK versions, dependencies
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── java/tr/bookhook/app/
│           ├── MainActivity.kt, BookHookApp.kt
│           ├── data/           Firebase repositories (Auth, Users, CheckIn, Feed) + models
│           ├── ui/auth/        Sign in / sign up screen
│           ├── ui/checkin/     "Bugün" screen
│           ├── ui/feed/        "Akış" screen
│           ├── ui/nav/         Top-level navigation (auth vs. signed-in shell, bottom tabs)
│           ├── ui/theme/       Material3 theme — colors mirror the web app's style.css tokens
│           └── util/           Logical-day helper (06:00 rollover, matching index.html)
└── build.gradle.kts, settings.gradle.kts, gradle/   Root Gradle project files
```

## Data model (must stay in sync with `index.html`)

The Android app reads/writes the exact same Firestore documents the web app does. If you change
a field name or shape on one side, update the other — there's no shared schema file, `data/*.kt`
on the Android side and the `firestore.rules` / the various `setDoc`/`addDoc` calls in `index.html`
on the web side are the two sources of truth right now.

| Collection | Fields this app uses |
|---|---|
| `users/{uid}` | `name`, `email`, `role`, `banned`, `phone`, `address`, `photoURL` |
| `days/{date}/answers/{uid}` | `status` ("read"/"skip"), `name`, `updatedAt` |
| `posts/{id}` | `type`, `uid`, `name`, `text`, `createdAt` (ISO-8601 string, not a Timestamp), `commentCount` |

## Next steps (suggested, not started)

- Extend `Post`/`FeedRepository` to render the other post types (`book_review`, `book_added`,
  gift/badge posts, ...) instead of falling back to their raw `type` string.
- A profile screen (the web app's signup enforces filling in surname/phone/address afterward).
- Push notifications (Firebase Cloud Messaging — the web app already has a Cloud Function,
  `sendPushOnNotification`, that fires for any `notifications/{uid}/items/{id}` document, so the
  Android side mainly needs to register an FCM token and request notification permission).
- Whatever look/layout you actually want — this skeleton uses plain Material3 components on
  purpose, as a neutral starting point.
