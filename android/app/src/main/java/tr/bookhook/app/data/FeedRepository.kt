package tr.bookhook.app.data

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import java.time.Instant

class FeedRepository(
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    /** Latest posts, live. `createdAt` is a plain ISO-8601 string (exactly like the web app
     *  writes it via `new Date().toISOString()`), not a Firestore Timestamp, so it still sorts
     *  chronologically as a string. This MVP only reads the base fields every post type shares
     *  (see index.html's createPost()) — type-specific fields (book covers, ratings, poll
     *  options, ...) aren't modeled here yet. */
    fun observeLatest(limit: Long = 30): Flow<List<Post>> =
        db.collection("posts")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(limit)
            .snapshots()
            .map { snap ->
                snap.documents.map { d ->
                    Post(
                        id = d.id,
                        type = d.getString("type") ?: "",
                        uid = d.getString("uid") ?: "",
                        name = d.getString("name") ?: "",
                        text = d.getString("text"),
                        createdAt = d.getString("createdAt") ?: "",
                        commentCount = d.getLong("commentCount") ?: 0,
                    )
                }
            }

    suspend fun createTextPost(uid: String, name: String, text: String) {
        val data = hashMapOf(
            "type" to "text",
            "uid" to uid,
            "name" to name,
            "text" to text,
            "createdAt" to Instant.now().toString(),
            "commentCount" to 0L,
        )
        db.collection("posts").add(data).await()
    }
}
