package tr.bookhook.app.ui.feed

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import tr.bookhook.app.data.Post

@Composable
fun FeedScreen(viewModel: FeedViewModel = viewModel()) {
    val state by viewModel.uiState.collectAsState()

    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Akış", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(bottom = 16.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = state.draft,
                onValueChange = viewModel::onDraftChange,
                placeholder = { Text("Ne düşünüyorsun?") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            IconButton(onClick = viewModel::submitPost, enabled = !state.isPosting && state.draft.isNotBlank()) {
                Icon(Icons.Filled.Send, contentDescription = "Gönder")
            }
        }

        if (state.posts.isEmpty()) {
            Text(
                "Henüz gönderi yok.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 24.dp),
            )
        } else {
            LazyColumn(contentPadding = PaddingValues(vertical = 16.dp)) {
                items(state.posts, key = { it.id }) { post ->
                    PostRow(post)
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun PostRow(post: Post) {
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
        Text(post.name.ifBlank { "(isimsiz)" }, style = MaterialTheme.typography.labelLarge)
        val body = when (post.type) {
            "text" -> post.text ?: ""
            "new_member" -> "kulübe katıldı 🎉"
            "read" -> "bugün okudu"
            else -> post.type
        }
        Text(body, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 2.dp))
    }
}
