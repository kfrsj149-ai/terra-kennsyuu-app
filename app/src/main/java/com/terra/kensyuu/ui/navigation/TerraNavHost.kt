package com.terra.kensyuu.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.terra.kensyuu.ui.measurement.MeasurementScreen
import com.terra.kensyuu.ui.menu.BackupScreen
import com.terra.kensyuu.ui.menu.ButtonSideScreen
import com.terra.kensyuu.ui.menu.CompanyScreen
import com.terra.kensyuu.ui.menu.HistoryDetailScreen
import com.terra.kensyuu.ui.menu.HistoryScreen
import com.terra.kensyuu.ui.menu.LanguageScreen
import com.terra.kensyuu.ui.menu.MenuDestination
import com.terra.kensyuu.ui.menu.MenuDrawerContent
import com.terra.kensyuu.ui.menu.PresetScreen
import com.terra.kensyuu.ui.menu.TruckScreen
import com.terra.kensyuu.ui.setup.SetupScreen
import com.terra.kensyuu.ui.terraApplication
import kotlinx.coroutines.launch

/**
 * アプリ強制終了時のデータ消失防止のため、起動時に未出力（作業中）の伝票が
 * あれば計測画面へ自動復帰する。無ければセットアップ画面から開始する。
 */
@Composable
fun TerraRoot() {
    val app = terraApplication()
    val startState = produceState<String?>(initialValue = null) {
        val draft = app.repository.getActiveDraftSlip()
        value = if (draft != null) TerraDestinations.measurement(draft.id) else TerraDestinations.SETUP
    }
    val startDestination = startState.value

    if (startDestination == null) {
        Box(modifier = Modifier.fillMaxSize()) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        }
        return
    }

    TerraNavHost(startDestination = startDestination)
}

@Composable
private fun TerraNavHost(startDestination: String) {
    val navController = rememberNavController()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    fun openDrawer() = scope.launch { drawerState.open() }
    fun closeDrawer() = scope.launch { drawerState.close() }

    fun navigateToMenu(destination: MenuDestination) {
        closeDrawer()
        val route = when (destination) {
            MenuDestination.COMPANIES -> TerraDestinations.COMPANIES
            MenuDestination.TRUCKS -> TerraDestinations.TRUCKS
            MenuDestination.PRESETS -> TerraDestinations.PRESETS
            MenuDestination.LANGUAGE -> TerraDestinations.LANGUAGE
            MenuDestination.BUTTON_SIDE -> TerraDestinations.BUTTON_SIDE
            MenuDestination.HISTORY -> TerraDestinations.HISTORY
            MenuDestination.BACKUP -> TerraDestinations.BACKUP
        }
        navController.navigate(route)
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = { MenuDrawerContent(onNavigate = ::navigateToMenu) }
    ) {
        NavHost(navController = navController, startDestination = startDestination) {
            composable(TerraDestinations.SETUP) {
                SetupScreen(
                    onMenuClick = { openDrawer() },
                    onMeasurementStarted = { slipId ->
                        navController.navigate(TerraDestinations.measurement(slipId)) {
                            popUpTo(TerraDestinations.SETUP) { inclusive = true }
                        }
                    }
                )
            }
            composable(
                TerraDestinations.MEASUREMENT,
                arguments = listOf(navArgument("slipId") { type = NavType.LongType })
            ) { backStackEntry ->
                val slipId = backStackEntry.arguments?.getLong("slipId") ?: return@composable
                MeasurementScreen(
                    slipId = slipId,
                    onExported = {
                        navController.navigate(TerraDestinations.SETUP) {
                            popUpTo(TerraDestinations.SETUP) { inclusive = true }
                        }
                    }
                )
            }
            composable(TerraDestinations.COMPANIES) {
                CompanyScreen(onBack = { navController.popBackStack() })
            }
            composable(TerraDestinations.TRUCKS) {
                TruckScreen(onBack = { navController.popBackStack() })
            }
            composable(TerraDestinations.PRESETS) {
                PresetScreen(onBack = { navController.popBackStack() })
            }
            composable(TerraDestinations.LANGUAGE) {
                LanguageScreen(onBack = { navController.popBackStack() })
            }
            composable(TerraDestinations.BUTTON_SIDE) {
                ButtonSideScreen(onBack = { navController.popBackStack() })
            }
            composable(TerraDestinations.BACKUP) {
                BackupScreen(onBack = { navController.popBackStack() })
            }
            composable(TerraDestinations.HISTORY) {
                HistoryScreen(
                    onBack = { navController.popBackStack() },
                    onOpenSlip = { slipId -> navController.navigate(TerraDestinations.historyDetail(slipId)) }
                )
            }
            composable(
                TerraDestinations.HISTORY_DETAIL,
                arguments = listOf(navArgument("slipId") { type = NavType.LongType })
            ) { backStackEntry ->
                val slipId = backStackEntry.arguments?.getLong("slipId") ?: return@composable
                HistoryDetailScreen(slipId = slipId, onBack = { navController.popBackStack() })
            }
        }
    }
}
