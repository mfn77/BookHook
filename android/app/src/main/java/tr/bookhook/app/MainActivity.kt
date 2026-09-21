package tr.bookhook.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import tr.bookhook.app.ui.nav.BookHookRoot
import tr.bookhook.app.ui.theme.BookHookTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BookHookTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    BookHookRoot()
                }
            }
        }
    }
}
