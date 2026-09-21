package tr.bookhook.app.ui.checkin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import tr.bookhook.app.data.DayAnswer

@Composable
fun CheckInScreen(viewModel: CheckInViewModel = viewModel()) {
    val state by viewModel.uiState.collectAsState()

    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Bugün", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Bugün kitap okudun mu?",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = { viewModel.mark("read") },
                enabled = !state.isUpdating,
                modifier = Modifier.weight(1f),
            ) { Text(if (state.myStatus == "read") "✓ Okudum" else "Okudum") }

            OutlinedButton(
                onClick = { viewModel.mark("skip") },
                enabled = !state.isUpdating,
                modifier = Modifier.weight(1f),
            ) { Text(if (state.myStatus == "skip") "✓ Okumadım" else "Okumadım") }
        }

        Text(
            "Bugün işaretleyenler",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 28.dp, bottom = 8.dp),
        )

        if (state.today.isEmpty()) {
            Text("Henüz kimse işaretlemedi.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Card {
                LazyColumn(contentPadding = PaddingValues(vertical = 4.dp)) {
                    items(state.today, key = { it.uid }) { answer ->
                        CheckInRow(answer)
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
private fun CheckInRow(answer: DayAnswer) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(answer.name.ifBlank { "(isimsiz)" })
        val (label, color) = when (answer.status) {
            "read" -> "Okudu" to MaterialTheme.colorScheme.secondary
            "skip" -> "Okumadı" to MaterialTheme.colorScheme.error
            else -> "-" to MaterialTheme.colorScheme.onSurfaceVariant
        }
        Text(label, color = color)
    }
}
