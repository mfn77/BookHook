package tr.bookhook.app

import android.app.Application

/** Firebase auto-initializes from google-services.json via the Firebase Initializer content
 *  provider — nothing to do here yet. Kept as a real Application subclass since it's the
 *  natural place to wire up Crashlytics/Messaging/etc. later without touching the manifest. */
class BookHookApp : Application()
