package tr.bookhook.app.ui.nav

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.google.firebase.auth.FirebaseAuth
import tr.bookhook.app.data.AuthRepository
import tr.bookhook.app.ui.auth.AuthScreen
import tr.bookhook.app.ui.checkin.CheckInScreen
import tr.bookhook.app.ui.feed.FeedScreen

private sealed class MainTab(val route: String, val label: String) {
    data object CheckIn : MainTab("checkin", "Bugün")
    data object Feed : MainTab("feed", "Akış")
}

private val mainTabs = listOf(MainTab.CheckIn, MainTab.Feed)

/** Top-level state: not signed in -> auth screen; signed in -> the main app shell. Session state
 *  comes straight from FirebaseAuth's listener (AuthRepository.currentUid), so a sign-in/out
 *  anywhere else in the app is reflected here automatically. */
@Composable
fun BookHookRoot() {
    val authRepository = remember { AuthRepository() }
    val uid by authRepository.currentUid.collectAsState(initial = "__loading__")

    when (uid) {
        "__loading__" -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        null -> AuthScreen()
        else -> MainShell()
    }
}

@Composable
private fun MainShell() {
    val navController = rememberNavController()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("BookHook") },
                actions = {
                    IconButton(onClick = { FirebaseAuth.getInstance().signOut() }) {
                        Icon(Icons.Filled.Logout, contentDescription = "Çıkış yap")
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                val backStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = backStackEntry?.destination
                mainTabs.forEach { tab ->
                    NavigationBarItem(
                        selected = currentDestination?.hierarchy?.any { it.route == tab.route } == true,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = {
                            Icon(
                                if (tab == MainTab.CheckIn) Icons.Filled.Home else Icons.Filled.Notifications,
                                contentDescription = tab.label,
                            )
                        },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = MainTab.CheckIn.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(MainTab.CheckIn.route) { CheckInScreen() }
            composable(MainTab.Feed.route) { FeedScreen() }
        }
    }
}
