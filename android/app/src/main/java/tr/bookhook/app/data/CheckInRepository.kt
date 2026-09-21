package tr.bookhook.app.data

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import tr.bookhook.app.util.logicalTodayStr
import java.time.Instant

class CheckInRepository(
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    /** All of today's `days/{today}/answers/*` docs, live — same collection the web app's
     *  weekly grid and "who checked in today" views read from. */
    fun observeToday(): Flow<List<DayAnswer>> {
        val today = logicalTodayStr()
        return db.collection("days").document(today).collection("answers")
            .snapshots()
            .map { snap ->
                snap.documents.map { d ->
                    DayAnswer(
                        uid = d.id,
                        name = d.getString("name") ?: "",
                        status = d.getString("status") ?: "",
                        auto = d.getBoolean("auto") ?: false,
                    )
                }
            }
    }

    /** Same toggle behavior as the web app's markStatus(): tapping the already-selected status
     *  again clears today's answer instead of re-writing it. */
    suspend fun markStatus(uid: String, name: String, status: String, currentStatus: String?) {
        val ref = db.collection("days").document(logicalTodayStr()).collection("answers").document(uid)
        if (currentStatus == status) {
            ref.delete().await()
        } else {
            val data = hashMapOf(
                "status" to status,
                "name" to name,
                "updatedAt" to Instant.now().toString(),
            )
            ref.set(data).await()
        }
    }
}
