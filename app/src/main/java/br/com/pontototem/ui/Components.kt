package br.com.pontototem.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.pontototem.data.Employee
import br.com.pontototem.data.Fmt
import br.com.pontototem.data.Punch
import br.com.pontototem.data.Repo
import br.com.pontototem.data.Role
import br.com.pontototem.data.Settings
import br.com.pontototem.data.TrustedClock
import kotlinx.coroutines.delay

enum class Screen {
    SETUP, HOME, PASSWORD, FACE, SUCCESS, RECEIPT, ERROR,
    ADMIN_PIN, ADMIN, EMPLOYEES, EMPLOYEE_FORM, ENROLL, FACE_TEST, FISCAL
}

/** Estado da interface. Vive enquanto a Activity vive, inclusive ao girar a tela. */
class AppState(val repo: Repo, val settings: Settings) {
    var screen by mutableStateOf(if (settings.setupDone) Screen.HOME else Screen.SETUP)
    var cpf by mutableStateOf("")
    var employee by mutableStateOf<Employee?>(null)
    var punch by mutableStateOf<Punch?>(null)
    var errorTitle by mutableStateOf("")
    var errorMessage by mutableStateOf("")
    var themeMode by mutableStateOf(settings.themeMode)
    var companyName by mutableStateOf(settings.companyName)
    var siteName by mutableStateOf(settings.siteName)
    var terminalId by mutableStateOf(settings.terminalId)
    var online by mutableStateOf(false)
    var pending by mutableStateOf(0)
    var employeeCount by mutableStateOf(-1)
    var logoVersion by mutableStateOf(0)

    // Area administrativa
    var role by mutableStateOf("")
    var editingId by mutableStateOf<String?>(null)
    var formMessage by mutableStateOf("")

    /** Quem aparece na trilha de auditoria. */
    fun actor(): String = if (role.isEmpty()) "Sistema" else Role.label(role)

    fun goHome() {
        cpf = ""
        employee = null
        punch = null
        role = ""
        editingId = null
        formMessage = ""
        screen = Screen.HOME
    }

    fun showError(title: String, message: String) {
        errorTitle = title
        errorMessage = message
        cpf = ""
        employee = null
        screen = Screen.ERROR
    }

    fun changeTheme(mode: String) {
        themeMode = mode
        settings.themeMode = mode
    }

    fun cycleTheme() {
        changeTheme(
            when (themeMode) {
                "SYSTEM" -> "LIGHT"
                "LIGHT" -> "DARK"
                else -> "SYSTEM"
            }
        )
    }
}

fun themeLabel(mode: String): String = when (mode) {
    "LIGHT" -> "Claro"
    "DARK" -> "Escuro"
    else -> "Automático"
}

// ---------------------------------------------------------------------------
// Estrutura das telas
// ---------------------------------------------------------------------------

/**
 * Duas areas que se reorganizam sozinhas: lado a lado em paisagem,
 * empilhadas em retrato. `secondCard` desenha a segunda area como cartao.
 */
@Composable
fun AdaptivePanes(
    firstWeight: Float,
    secondWeight: Float,
    secondCard: Boolean,
    first: @Composable ColumnScope.() -> Unit,
    second: @Composable ColumnScope.() -> Unit
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp)
    ) {
        val portrait = maxHeight > maxWidth
        val secondBody: @Composable (Modifier) -> Unit = { paneModifier ->
            if (secondCard) {
                Surface(
                    modifier = paneModifier,
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 28.dp, vertical = 24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        content = second
                    )
                }
            } else {
                Column(
                    modifier = paneModifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    content = second
                )
            }
        }
        if (portrait) {
            Column(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(20.dp)
            ) {
                Column(
                    modifier = Modifier
                        .weight(firstWeight)
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    content = first
                )
                secondBody(
                    Modifier
                        .weight(secondWeight)
                        .fillMaxWidth()
                )
            }
        } else {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    content = first
                )
                secondBody(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                )
            }
        }
    }
}

@Composable
fun SplitLayout(
    left: @Composable ColumnScope.() -> Unit,
    right: @Composable ColumnScope.() -> Unit
) {
    AdaptivePanes(
        firstWeight = 0.32f,
        secondWeight = 0.68f,
        secondCard = true,
        first = left,
        second = right
    )
}

/** Painel de informacoes: logotipo, empresa, obra, relogio com segundos, conexao e terminal. */
@Composable
fun ColumnScope.InfoPanel(
    state: AppState,
    onOpenAdmin: () -> Unit,
    showAdminButton: Boolean = false
) {
    val now by produceState(initialValue = TrustedClock.now()) {
        while (true) {
            value = TrustedClock.now()
            delay(250)
        }
    }
    val colors = MaterialTheme.colorScheme
    val logo = remember(state.logoVersion) {
        val path = state.repo.logoPath()
        if (path == null) null else BitmapFactory.decodeFile(path)?.asImageBitmap()
    }

    if (logo != null) {
        Image(
            bitmap = logo,
            contentDescription = "Logotipo de ${state.companyName}",
            modifier = Modifier
                .heightIn(max = 64.dp)
                .widthIn(max = 260.dp),
            contentScale = ContentScale.Fit,
            alignment = Alignment.CenterStart
        )
        VSpace(10)
    }
    Text(
        text = state.companyName,
        style = MaterialTheme.typography.titleLarge,
        color = colors.onBackground,
        maxLines = 1
    )
    if (state.siteName.isNotEmpty()) {
        Text(
            text = state.siteName,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.onSurfaceVariant,
            maxLines = 1
        )
    }
    Spacer(Modifier.weight(1f))
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val clockStyle = if (maxWidth < 520.dp) {
            MaterialTheme.typography.displayLarge.copy(fontSize = 60.sp, lineHeight = 66.sp)
        } else {
            MaterialTheme.typography.displayLarge
        }
        Text(
            text = Fmt.time(now),
            style = clockStyle,
            color = colors.onBackground,
            maxLines = 1,
            softWrap = false
        )
    }
    Text(
        text = Fmt.date(now).replaceFirstChar { it.uppercase() },
        style = MaterialTheme.typography.titleMedium,
        color = colors.onSurfaceVariant
    )
    Spacer(Modifier.weight(1f))
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        StatusPill(online = state.online, pending = state.pending)
        Text(
            text = "Terminal ${state.terminalId}",
            style = MaterialTheme.typography.labelMedium,
            color = colors.onSurfaceVariant,
            maxLines = 1,
            modifier = Modifier
                .pointerInput(Unit) {
                    detectTapGestures(onLongPress = { onOpenAdmin() })
                }
                .padding(vertical = 10.dp)
        )
        Spacer(Modifier.weight(1f))
        if (showAdminButton) {
            Pill(text = "Administração", onClick = onOpenAdmin)
        }
        Pill(
            text = "Tema: ${themeLabel(state.themeMode)}",
            onClick = { state.cycleTheme() }
        )
    }
}

@Composable
fun StatusPill(online: Boolean, pending: Int) {
    val status = LocalStatusColors.current
    val dot = if (online) status.success else status.warning
    val label = when {
        online && pending == 0 -> "On-line"
        online -> "On-line · $pending a enviar"
        pending == 0 -> "Off-line"
        else -> "Off-line · $pending a enviar"
    }
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Box(
            Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(dot)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

@Composable
fun Pill(text: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

// ---------------------------------------------------------------------------
// Botoes e teclado
// ---------------------------------------------------------------------------

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 56.dp),
        shape = MaterialTheme.shapes.medium,
        colors = ButtonDefaults.buttonColors(
            disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant
        )
    ) {
        Text(text = text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = 56.dp),
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

/** Teclado numerico. Ocupa a altura que sobrar, ate um limite confortavel. */
@Composable
fun Keypad(
    onDigit: (Char) -> Unit,
    onBackspace: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier
) {
    val rows = listOf("123", "456", "789")
    Column(
        modifier = modifier
            .widthIn(max = 460.dp)
            .heightIn(max = 380.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        for (row in rows) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                for (ch in row) {
                    Key(label = ch.toString(), modifier = Modifier.weight(1f)) { onDigit(ch) }
                }
            }
        }
        Row(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Key(label = "Limpar", modifier = Modifier.weight(1f), quiet = true, onClick = onClear)
            Key(label = "0", modifier = Modifier.weight(1f)) { onDigit('0') }
            Key(label = "Apagar", modifier = Modifier.weight(1f), quiet = true, onClick = onBackspace)
        }
    }
}

@Composable
private fun Key(
    label: String,
    modifier: Modifier = Modifier,
    quiet: Boolean = false,
    onClick: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    Box(
        modifier = modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(14.dp))
            .background(if (quiet) Color.Transparent else colors.surfaceVariant)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = if (quiet) {
                MaterialTheme.typography.titleMedium
            } else {
                MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Medium)
            },
            color = if (quiet) colors.onSurfaceVariant else colors.onSurface,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
fun Banner(text: String, tone: Color) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.small)
            .background(tone.copy(alpha = 0.14f))
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

@Composable
fun VSpace(dp: Int) {
    Spacer(Modifier.height(dp.dp))
}
