package tr.bookhook.app.ui.checkin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tr.bookhook.app.data.CheckInRepository
import tr.bookhook.app.data.DayAnswer
import tr.bookhook.app.data.UserRepository

data class CheckInUiState(
    val myStatus: String? = null, // "read" | "skip" | null (not marked yet)
    val today: List<DayAnswer> = emptyList(),
    val isUpdating: Boolean = false,
)

class CheckInViewModel(
    private val checkInRepository: CheckInRepository = CheckInRepository(),
    private val userRepository: UserRepository = UserRepository(),
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(CheckInUiState())
    val uiState: StateFlow<CheckInUiState> = _uiState

    private val uid: String? get() = auth.currentUser?.uid

    init {
        val myUid = uid
        if (myUid != null) {
            viewModelScope.launch {
                checkInRepository.observeToday().collect { answers ->
                    _uiState.value = _uiState.value.copy(
                        today = answers,
                        myStatus = answers.firstOrNull { it.uid == myUid }?.status,
                    )
                }
            }
        }
    }

    fun mark(status: String) {
        val myUid = uid ?: return
        _uiState.value = _uiState.value.copy(isUpdating = true)
        viewModelScope.launch {
            val myName = userRepository.observeProfile(myUid).first()?.name ?: ""
            checkInRepository.markStatus(myUid, myName, status, _uiState.value.myStatus)
            _uiState.value = _uiState.value.copy(isUpdating = false)
        }
    }
}
