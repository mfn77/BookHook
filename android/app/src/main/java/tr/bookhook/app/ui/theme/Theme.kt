package tr.bookhook.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Gold,
    onPrimary = Color(0xFFFFFFFF),
    secondary = Forest,
    error = Cloth,
    background = LightPaper,
    onBackground = LightInk,
    surface = LightCard,
    onSurface = LightInk,
    surfaceVariant = LightPaper2,
    onSurfaceVariant = LightInk70,
    outline = LightLine,
)

private val DarkColors = darkColorScheme(
    primary = GoldDarkMode,
    onPrimary = Color(0xFF00363D),
    secondary = ForestDarkMode,
    error = ClothDarkMode,
    background = DarkPaper,
    onBackground = DarkInk,
    surface = DarkCard,
    onSurface = DarkInk,
    surfaceVariant = DarkPaper2,
    onSurfaceVariant = DarkInk70,
    outline = DarkLine,
)

@Composable
fun BookHookTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colors = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colors,
        typography = BookHookTypography,
        content = content
    )
}
