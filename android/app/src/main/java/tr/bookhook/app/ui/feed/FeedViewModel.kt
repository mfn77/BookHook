package tr.bookhook.app.ui.feed

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tr.bookhook.app.data.FeedRepository
import tr.bookhook.app.data.Post
import tr.bookhook.app.data.UserRepository

data class FeedUiState(
    val posts: List<Post> = emptyList(),
    val draft: String = "",
    val isPosting: Boolean = false,
)

class FeedViewModel(
    private val feedRepository: FeedRepository = FeedRepository(),
    private val userRepository: UserRepository = UserRepository(),
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(FeedUiState())
    val uiState: StateFlow<FeedUiState> = _uiState

    init {
        viewModelScope.launch {
            feedRepository.observeLatest().collect { posts ->
                _uiState.value = _uiState.value.copy(posts = posts)
            }
        }
    }

    fun onDraftChange(value: String) {
        _uiState.value = _uiState.value.copy(draft = value)
    }

    fun submitPost() {
        val myUid = auth.currentUser?.uid ?: return
        val text = _uiState.value.draft.trim()
        if (text.isEmpty() || _uiState.value.isPosting) return
        _uiState.value = _uiState.value.copy(isPosting = true)
        viewModelScope.launch {
            val myName = userRepository.observeProfile(myUid).first()?.name ?: ""
            feedRepository.createTextPost(myUid, myName, text)
            _uiState.value = _uiState.value.copy(isPosting = false, draft = "")
        }
    }
}
