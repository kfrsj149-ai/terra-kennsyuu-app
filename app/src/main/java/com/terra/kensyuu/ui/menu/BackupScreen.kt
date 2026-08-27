package com.terra.kensyuu.ui.menu

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.terra.kensyuu.R
import com.terra.kensyuu.data.backup.BackupScheduler
import com.terra.kensyuu.data.backup.GoogleSignInHelper
import com.terra.kensyuu.data.settings.AppSettings
import com.terra.kensyuu.ui.components.TerraLargeButton
import com.terra.kensyuu.ui.terraApplication
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupScreen(onBack: () -> Unit) {
    val app = terraApplication()
    val context = LocalContext.current
    val settings by app.settingsRepository.settings.collectAsState(initial = AppSettings.DEFAULT)
    val scope = rememberCoroutineScope()
    var account by remember { mutableStateOf(GoogleSignInHelper.lastSignedInAccount(context)) }

    val signInLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
        account = runCatching { task.result }.getOrNull()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.backup_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(stringResource(R.string.backup_description), style = MaterialTheme.typography.bodyMedium)

            if (account == null) {
                TerraLargeButton(
                    text = stringResource(R.string.backup_sign_in),
                    onClick = { signInLauncher.launch(GoogleSignInHelper.client(context).signInIntent) }
                )
            } else {
                Text(
                    stringResource(R.string.backup_signed_in_as, account?.email ?: ""),
                    style = MaterialTheme.typography.bodyLarge
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(stringResource(R.string.backup_enable), style = MaterialTheme.typography.bodyLarge)
                Switch(
                    checked = settings.backupEnabled,
                    enabled = account != null,
                    onCheckedChange = { enabled ->
                        scope.launch { app.settingsRepository.setBackupEnabled(enabled) }
                        if (enabled) BackupScheduler.schedule(context) else BackupScheduler.cancel(context)
                    }
                )
            }

            val lastBackupText = settings.lastBackupAtMillis?.let {
                SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(it))
            } ?: stringResource(R.string.backup_never)
            Text(
                stringResource(R.string.backup_last_success, lastBackupText),
                style = MaterialTheme.typography.bodyMedium
            )

            if (account != null && settings.backupEnabled) {
                TerraLargeButton(
                    text = stringResource(R.string.backup_run_now),
                    onClick = { BackupScheduler.runNow(context) }
                )
            }
        }
    }
}
