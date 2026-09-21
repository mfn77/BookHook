package tr.bookhook.app.data

/** Mirrors the `users/{uid}` document fields written by the web app (see index.html's signup flow). */
data class UserProfile(
    val uid: String = "",
    val name: String = "",
    val email: String = "",
    val role: String = "member",
    val banned: Boolean = false,
    val phone: String = "",
    val address: String = "",
    val photoURL: String = "",
)

/** Mirrors one `days/{date}/answers/{uid}` document. */
data class DayAnswer(
    val uid: String = "",
    val name: String = "",
    val status: String = "", // "read" | "skip"
    val auto: Boolean = false,
)

/** Mirrors one `posts/{postId}` document (only the base fields every post type shares). */
data class Post(
    val id: String = "",
    val type: String = "",
    val uid: String = "",
    val name: String = "",
    val text: String? = null,
    val createdAt: String = "",
    val commentCount: Long = 0,
)
