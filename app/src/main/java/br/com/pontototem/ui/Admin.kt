package br.com.pontototem.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import br.com.pontototem.data.Cpf
import br.com.pontototem.data.Fmt
import br.com.pontototem.data.Punch
import br.com.pontototem.data.SyncEntry
import br.com.pontototem.data.SyncStatus
import br.com.pontototem.face.hasAnyCamera
import br.com.pontototem.kiosk.Kiosk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// ---------------------------------------------------------------------------
// Senha da area administrativa
// ---------------------------------------------------------------------------

@Composable
fun AdminPinScreen(state: AppState) {
    var pin by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }

    LaunchedEffect(pin) {
        delay(20_000)
        state.goHome()
    }

    SplitLayout(
        left = { InfoPanel(state = state, onOpenAdmin = {}) },
        right = {
            val colors = MaterialTheme.colorScheme
            Text(
                text = "Área administrativa",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.onSurface
            )
            VSpace(4)
            Text(
                text = if (wrong) "Senha incorreta" else "Digite a senha do administrador",
                style = MaterialTheme.typography.bodyLarge,
                color = if (wrong) colors.error else colors.onSurfaceVariant
            )
            VSpace(16)
            Row(
                modifier = Modifier.padding(vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                val slots = if (pin.length > 4) pin.length else 4
                for (i in 0 until slots) {
                    Box(
                        Modifier
                            .size(18.dp)
                            .clip(CircleShape)
                            .background(if (i < pin.length) colors.onSurface else colors.outline)
                    )
                }
            }
            VSpace(16)
            Keypad(
                onDigit = { d ->
                    wrong = false
                    if (pin.length < 8) pin += d
                },
                onBackspace = { pin = pin.dropLast(1) },
                onClear = { pin = "" },
                modifier = Modifier.weight(1f)
            )
            VSpace(16)
            Row(
                modifier = Modifier
                    .widthIn(max = 420.dp)
                    .fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                SecondaryButton(
                    text = "Voltar",
                    onClick = { state.goHome() },
                    modifier = Modifier.weight(1f)
                )
                PrimaryButton(
                    text = "Entrar",
                    enabled = pin.length >= 4,
                    onClick = {
                        if (pin == state.settings.adminPin) {
                            state.screen = Screen.ADMIN
                        } else {
                            wrong = true
                            pin = ""
                        }
                    },
                    modifier = Modifier.weight(1f)
                )
            }
        }
    )
}

// ---------------------------------------------------------------------------
// Area administrativa
// ---------------------------------------------------------------------------

@Composable
fun AdminScreen(state: AppState, onKioskChanged: (Boolean) -> Unit, onCloseApp: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme
    val settings = state.settings

    var refresh by remember { mutableIntStateOf(0) }
    var total by remember { mutableIntStateOf(0) }
    var log by remember { mutableStateOf(emptyList<SyncEntry>()) }
    var punches by remember { mutableStateOf(emptyList<Punch>()) }
    var company by remember { mutableStateOf(settings.companyName) }
    var terminal by remember { mutableStateOf(settings.terminalId) }
    var apiUrl by remember { mutableStateOf(settings.apiUrl) }
    var simulateOffline by remember { mutableStateOf(settings.simulateOffline) }
    var kiosk by remember { mutableStateOf(settings.kioskLock) }

    val version = remember {
        try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
        } catch (e: Exception) {
            "?"
        }
    }
    val deviceOwner = remember { Kiosk.isDeviceOwner(context) }
    val camera = remember { hasAnyCamera(context) }

    LaunchedEffect(refresh) {
        val repo = state.repo
        val loaded = withContext(Dispatchers.IO) {
            Triple(repo.totalCount(), repo.syncLog(8), repo.recentPunches(8))
        }
        total = loaded.first
        log = loaded.second
        punches = loaded.third
        state.pending = withContext(Dispatchers.IO) { repo.pendingCount() }
        state.online = withContext(Dispatchers.IO) { repo.isOnline() }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .imePadding(),
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 920.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Área administrativa",
                    style = MaterialTheme.typography.headlineMedium,
                    color = colors.onBackground,
                    modifier = Modifier.weight(1f)
                )
                SecondaryButton(text = "Sair", onClick = { state.goHome() })
            }

            VSpace(20)
            SectionTitle("Status")
            Card {
                InfoRow("Conexão", if (state.online) "On-line" else "Off-line")
                InfoRow("Registros pendentes", state.pending.toString())
                InfoRow("Registros no aparelho", total.toString())
                InfoRow("Câmera", if (camera) "Disponível" else "Não encontrada")
                InfoRow(
                    "Modo totem",
                    if (deviceOwner) "Ativo (Device Owner)" else "Parcial: app não é Device Owner"
                )
                InfoRow("Versão", version, last = true)
            }
            VSpace(12)
            PrimaryButton(
                text = "Sincronizar agora",
                onClick = {
                    scope.launch {
                        withContext(Dispatchers.IO) { state.repo.syncPending() }
                        refresh += 1
                    }
                },
                modifier = Modifier.fillMaxWidth()
            )

            VSpace(28)
            SectionTitle("Terminal")
            OutlinedTextField(
                value = company,
                onValueChange = {
                    company = it
                    settings.companyName = it
                    state.companyName = it
                },
                label = { Text("Empresa") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            VSpace(12)
            OutlinedTextField(
                value = terminal,
                onValueChange = {
                    terminal = it
                    settings.terminalId = it
                    state.terminalId = it
                },
                label = { Text("Identificação do terminal") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            VSpace(12)
            OutlinedTextField(
                value = apiUrl,
                onValueChange = {
                    apiUrl = it
                    settings.apiUrl = it
                },
                label = { Text("URL do serviço REP-P") },
                supportingText = { Text("Ainda não utilizada: esta versão roda em modo demonstração.") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            VSpace(20)
            SectionTitle("Operação")
            Card {
                ToggleRow(
                    title = "Simular falta de internet",
                    detail = "Para testar a fila de marcações off-line.",
                    checked = simulateOffline,
                    onChange = {
                        simulateOffline = it
                        settings.simulateOffline = it
                        refresh += 1
                    }
                )
                HorizontalDivider(color = colors.outlineVariant)
                ToggleRow(
                    title = "Travar o aparelho no aplicativo",
                    detail = "Só tem efeito completo quando o app é Device Owner.",
                    checked = kiosk,
                    onChange = {
                        kiosk = it
                        settings.kioskLock = it
                        onKioskChanged(it)
                    }
                )
            }
            VSpace(12)
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Tema",
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.onBackground,
                    modifier = Modifier.weight(1f)
                )
                for (mode in listOf("SYSTEM", "LIGHT", "DARK")) {
                    if (state.themeMode == mode) {
                        PrimaryButton(text = themeLabel(mode), onClick = {})
                    } else {
                        SecondaryButton(text = themeLabel(mode), onClick = { state.changeTheme(mode) })
                    }
                }
            }

            VSpace(28)
            SectionTitle("Histórico de sincronizações")
            Card {
                if (log.isEmpty()) {
                    InfoRow("Nenhuma sincronização ainda", "", last = true)
                }
                for ((i, entry) in log.withIndex()) {
                    InfoRow(
                        Fmt.dateTime(entry.at),
                        (if (entry.ok) "${entry.count} enviado(s). " else "Falha. ") + entry.message,
                        last = i == log.size - 1
                    )
                }
            }

            VSpace(28)
            SectionTitle("Últimas marcações")
            Card {
                if (punches.isEmpty()) {
                    InfoRow("Nenhuma marcação ainda", "", last = true)
                }
                for ((i, p) in punches.withIndex()) {
                    val sync = if (p.syncStatus == SyncStatus.SENT) "Enviado" else "Pendente"
                    val origin = if (p.online) "on-line" else "off-line"
                    InfoRow(
                        Fmt.dateTime(p.markedAt),
                        "${Cpf.masked(p.cpf)} · $origin · $sync",
                        last = i == punches.size - 1
                    )
                }
            }

            VSpace(28)
            SecondaryButton(
                text = "Fechar aplicativo",
                onClick = onCloseApp,
                modifier = Modifier.fillMaxWidth()
            )
            VSpace(24)
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = 10.dp)
    )
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 18.dp)
    ) {
        content()
    }
}

@Composable
private fun InfoRow(label: String, value: String, last: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.onSurface,
            modifier = Modifier.weight(0.4f)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.onSurfaceVariant,
            modifier = Modifier.weight(0.6f)
        )
    }
    if (!last) HorizontalDivider(color = colors.outlineVariant)
}

@Composable
private fun ToggleRow(title: String, detail: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(text = title, style = MaterialTheme.typography.bodyLarge, color = colors.onSurface)
            Text(text = detail, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
        }
        Spacer(Modifier.size(12.dp))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
