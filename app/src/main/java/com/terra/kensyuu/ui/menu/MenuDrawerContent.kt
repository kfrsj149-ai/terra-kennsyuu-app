package com.terra.kensyuu.ui.menu

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.terra.kensyuu.R

enum class MenuDestination {
    COMPANIES, TRUCKS, PRESETS, LANGUAGE, BUTTON_SIDE, HISTORY, BACKUP
}

@Composable
fun MenuDrawerContent(onNavigate: (MenuDestination) -> Unit) {
    ModalDrawerSheet {
        Text(
            stringResource(R.string.menu_title),
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(16.dp)
        )
        HorizontalDivider()
        Text(
            stringResource(R.string.menu_settings_section),
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )
        NavigationDrawerItem(
            label = { Text(stringResource(R.string.menu_companies)) },
            selected = false,
            onClick = { onNavigate(MenuDestination.COMPANIES) }
        )
        NavigationDrawerItem(
            label = { Text(stringResource(R.string.menu_trucks)) },
            selected = false,
            onClick = { onNavigate(MenuDestination.TRUCKS) }
        )
        NavigationDrawerItem(
            label = { Text(stringResource(R.string.menu_presets)) },
            selected = false,
            onClick = { onNavigate(MenuDestination.PRESETS) }
        )
        NavigationDrawerItem(
            label = { Text(stringResource(R.string.menu_language)) },
            selected = false,
            onClick = { onNavigate(MenuDestination.LANGUAGE) }
        )
        NavigationDrawerItem(
            label = { Text(stringResource(R.string.menu_button_side)) },
            selected = false,
            onClick = { onNavigate(MenuDestination.BUTTON_SIDE) }
        )
        HorizontalDivider()
        NavigationDrawerItem(
            label = { Text(stringResource(R.string.menu_history)) },
            selected = false,
            onClick = { onNavigate(MenuDestination.HISTORY) }
        )
        NavigationDrawerItem(
            label = { Text(stringResource(R.string.menu_backup)) },
            selected = false,
            onClick = { onNavigate(MenuDestination.BACKUP) }
        )
    }
}
