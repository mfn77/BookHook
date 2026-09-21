package tr.bookhook.app.data

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class UserRepository(
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    /** Live profile for a given uid, or null while loading / if the document doesn't exist. */
    fun observeProfile(uid: String): Flow<UserProfile?> =
        db.collection("users").document(uid).snapshots().map { snap ->
            if (!snap.exists()) null
            else UserProfile(
                uid = snap.id,
                name = snap.getString("name") ?: "",
                email = snap.getString("email") ?: "",
                role = snap.getString("role") ?: "member",
                banned = snap.getBoolean("banned") ?: false,
                phone = snap.getString("phone") ?: "",
                address = snap.getString("address") ?: "",
                photoURL = snap.getString("photoURL") ?: "",
            )
        }
}
