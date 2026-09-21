package tr.bookhook.app.data

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.time.Instant

class AuthRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    /** Emits the current uid (or null when signed out) every time Firebase Auth's state changes. */
    val currentUid: Flow<String?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { trySend(it.currentUser?.uid) }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    suspend fun signIn(email: String, password: String) {
        auth.signInWithEmailAndPassword(email, password).await()
    }

    /** Creates the Firebase Auth account, then the matching `users/{uid}` profile document
     *  (same shape the web app writes at signup) — Firestore rules require both the uid and
     *  role == 'member' to match on create, so this must run right after auth succeeds. */
    suspend fun signUp(name: String, email: String, password: String) {
        val result = auth.createUserWithEmailAndPassword(email, password).await()
        val uid = result.user?.uid ?: error("Signup succeeded but no user id was returned")
        val profile = hashMapOf(
            "name" to name,
            "email" to email,
            "role" to "member",
            "banned" to false,
            "phone" to "",
            "address" to "",
            "photoURL" to "",
            "createdAt" to Instant.now().toString(),
        )
        db.collection("users").document(uid).set(profile).await()
    }

    fun signOut() = auth.signOut()
}
