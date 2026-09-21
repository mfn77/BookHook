package tr.bookhook.app.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tr.bookhook.app.data.AuthRepository

data class AuthUiState(
    val isSignUpMode: Boolean = false,
    val name: String = "",
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
)

class AuthViewModel(
    private val repository: AuthRepository = AuthRepository(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState

    fun toggleMode() = _uiState.update { it.copy(isSignUpMode = !it.isSignUpMode, error = null) }
    fun onNameChange(value: String) = _uiState.update { it.copy(name = value) }
    fun onEmailChange(value: String) = _uiState.update { it.copy(email = value) }
    fun onPasswordChange(value: String) = _uiState.update { it.copy(password = value) }

    fun submit() {
        val state = _uiState.value
        if (state.isLoading) return
        if (state.email.isBlank() || state.password.isBlank() || (state.isSignUpMode && state.name.isBlank())) {
            _uiState.update { it.copy(error = "Lütfen tüm alanları doldurun.") }
            return
        }
        _uiState.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            try {
                if (state.isSignUpMode) {
                    repository.signUp(state.name.trim(), state.email.trim(), state.password)
                } else {
                    repository.signIn(state.email.trim(), state.password)
                }
                // On success the AuthRepository.currentUid flow (observed higher up in the nav
                // graph) will fire and navigate away from this screen.
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message ?: "Bir şeyler ters gitti.") }
                return@launch
            }
            _uiState.update { it.copy(isLoading = false) }
        }
    }
}
