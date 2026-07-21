# BookHook

BookHook is a Firebase-based Progressive Web App (PWA) built for a private book club (originally run over WhatsApp). It combines daily reading tracking, a fairness-based penalty lottery, a gift-book exchange system, and a small social feed for book discovery and discussion.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Security](#security)
- [License](#license)

## Features

### Daily Reading Tracking

- Members mark whether they read on a given day ("Read" / "Did not read"), with the logical day boundary rolling over at 06:00 local time.
- Admins can mark on behalf of any member and edit past days.
- A weekly report table shows every member's status per day, with per-week penalty/pass/clean summaries.
- Streak tracking and a tiered badge system (3/5/7/14/21/30 consecutive days), with a badge history table.

### Lottery and Gift Books

- Members who miss two or more days in a week are automatically entered into a fairness-weighted lottery against members with a clean or single-pass record.
- The receiving member can search for and select the book they want (with automatic cover art), with address and phone number pre-filled from their profile.
- A shipped/received confirmation flow tracks the full lifecycle of each gift, with history for completed exchanges.

### Social (Feed and Discover)

- A shared feed automatically posts reading check-ins, badges earned or lost, gift books won or received, new member sign-ups, and book ratings/reviews.
- Members can also compose their own text or image posts.
- Posts and comments support emoji reactions, including a custom emoji picker.
- A Discover tab surfaces popular books by genre (via Open Library), highlights books the group has rated, and lets members submit a 1-10 rating and review, which is also shared to the feed.

### Other

- Personal reading history ("library") per member, viewable from any profile.
- Tapping a book cover or title anywhere in the app shows author, publisher, genre, and rating information (Open Library, with Google Books as a fallback).
- Personal and group book recommendations with comments and reactions.
- Real-time push notifications (Firebase Cloud Messaging), plus scheduled reminders sent twice daily to members who have not yet checked in.
- Installable as a PWA on mobile and desktop, with offline asset caching via a service worker.

## Tech Stack

- **Frontend**: A single-file vanilla HTML/CSS/JavaScript application (`index.html`), with no build step or framework dependency.
- **Backend**: [Firebase](https://firebase.google.com/) - Authentication, Firestore, and Cloud Functions (2nd gen) for push notifications and scheduled reminders.
- **Hosting**: Static hosting on GitHub Pages, with a service worker (`sw.js`) handling caching and background push delivery.
- **External data**: [Open Library API](https://openlibrary.org/developers/api) as the primary book data source, with the [Google Books API](https://developers.google.com/books) as a fallback.

## Project Structure

```
.
├── index.html               Application source (HTML, CSS, and JavaScript)
├── sw.js                    Service worker: asset caching and background push notifications
├── manifest.json            PWA manifest (name, icons, theme color)
├── icon-512.png             App icon (home screen / favicon)
├── icon-192.png
├── apple-touch-icon.png
├── favicon.png
├── logo-mark.png            In-app logo (sign-in screen and sidebar), transparent background
├── firestore.rules          Firestore security rules
└── cloud-function-debug/
    └── index.js             Cloud Functions source (push notifications and scheduled reminders)
```

## Getting Started

### Prerequisites

- A [Firebase](https://console.firebase.google.com/) project on the Blaze (pay-as-you-go) plan, required for Cloud Functions and scheduled jobs.
- The [Firebase CLI](https://firebase.google.com/docs/cli), for deploying Cloud Functions.

### Firebase Project Setup

1. Create a new Firebase project.
2. Under **Authentication**, enable the Email/Password provider (and Google, if desired).
3. Under **Firestore Database**, create a database, then paste the contents of `firestore.rules` into the Rules tab and publish.
4. Under **Cloud Messaging**, generate a Web Push certificate (VAPID key).
5. In `index.html`, replace the Firebase configuration object (`apiKey`, `authDomain`, `projectId`, etc.) and the VAPID key with the values from your own project.

### Cloud Functions

Deploy the contents of `cloud-function-debug/index.js` to your Firebase project:

```
firebase deploy --only functions
```

This provisions three functions:

- `sendPushOnNotification` - sends a push notification whenever an in-app notification document is created.
- `readingReminderNoon` / `readingReminderNight` - scheduled functions that run daily at 14:00 and 22:00 (Europe/Istanbul time) and notify members who have not yet checked in for the day. These require Cloud Scheduler, which is only available on the Blaze plan.

### Google Books API Key (optional)

Open Library is used as the primary book data source and requires no API key. If you want to configure Google Books as a more reliable fallback, add your own key to the `GOOGLE_BOOKS_API_KEY` constant in `index.html`, and restrict it to your domain in Google Cloud Console.

## Configuration

All configuration lives directly in `index.html` as plain constants near the top of the script:

| Constant | Purpose |
|---|---|
| Firebase config object | Identifies which Firebase project the app talks to. |
| `FCM_VAPID_KEY` | Public key used to register for Web Push notifications. |
| `GOOGLE_BOOKS_API_KEY` | Optional key for the Google Books fallback search. |
| `CLUB_START_DATE` | The date reading tracking begins for the club. |

## Deployment

1. Push all files to the `main` branch of your GitHub repository.
2. In the repository settings, under **Pages**, set the source to the `main` branch.
3. The app will be published at `https://<your-username>.github.io/<your-repo>/`.

### First Admin Account

For security, no account can assign itself the admin role at sign-up; Firestore rules enforce that every new account is created with the `member` role.

1. Sign up normally through the app.
2. In Firebase Console, go to **Firestore Database**, open the `users` collection, and find your document.
3. Change the `role` field from `member` to `admin`, and save.

Subsequent admins do not require manual database edits: an existing admin can promote or demote any member from the in-app **Members** screen.

## Security

- The Firebase client configuration and VAPID key are public by design; Google's security model relies on Firestore rules and Authentication, not on hiding these values.
- No account can self-assign the admin role; this is enforced server-side by Firestore rules, not just in client code.
- If you use the Google Books API key, restrict it by HTTP referrer in Google Cloud Console so it can only be used from your own domain.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
