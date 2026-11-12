package br.com.pontototem.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import br.com.pontototem.data.Cpf
import br.com.pontototem.data.FaceStatus
import br.com.pontototem.data.Fmt
import br.com.pontototem.face.FaceCamera
import br.com.pontototem.face.FaceSample
import br.com.pontototem.face.hasAnyCamera
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs

// ---------------------------------------------------------------------------
// 1. Tela inicial: CPF
// ---------------------------------------------------------------------------

@Composable
fun HomeScreen(state: AppState) {
    SplitLayout(
        left = { InfoPanel(state = state, onOpenAdmin = { state.screen = Screen.ADMIN_PIN }) },
        right = {
            val complete = state.cpf.length == 11
            val valid = complete && Cpf.isValid(state.cpf)
            val colors = MaterialTheme.colorScheme

            Text(
                text = "Registrar ponto",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.onSurface
            )
            VSpace(4)
            Text(
                text = "Digite seu CPF",
                style = MaterialTheme.typography.bodyLarge,
                color = colors.onSurfaceVariant
            )
            VSpace(16)
            Text(
                text = Cpf.formatPartial(state.cpf),
                style = MaterialTheme.typography.displayMedium,
                color = if (complete && !valid) colors.error else colors.onSurface,
                maxLines = 1,
                softWrap = false
            )
            Text(
                text = if (complete && !valid) "CPF inválido. Confira os números." else " ",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.error
            )
            VSpace(8)
            Keypad(
                onDigit = { d -> if (state.cpf.length < 11) state.cpf += d },
                onBackspace = { state.cpf = state.cpf.dropLast(1) },
                onClear = { state.cpf = "" },
                modifier = Modifier.weight(1f)
            )
            VSpace(16)
            PrimaryButton(
                text = "Avançar",
                onClick = { state.screen = Screen.PASSWORD },
                enabled = valid,
                modifier = Modifier
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
            )
            VSpace(10)
            Text(
                text = "Demonstração: CPF 111.444.777-35, senha 1234",
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    )
}

// ---------------------------------------------------------------------------
// 2. Senha
// ---------------------------------------------------------------------------

@Composable
fun PasswordScreen(state: AppState) {
    var pin by remember { mutableStateOf("") }

    // Encerra a sessao apos 30 segundos sem digitacao.
    LaunchedEffect(pin) {
        delay(30_000)
        state.goHome()
    }

    SplitLayout(
        left = { InfoPanel(state = state, onOpenAdmin = {}) },
        right = {
            val colors = MaterialTheme.colorScheme
            Text(
                text = "Digite sua senha",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.onSurface
            )
            VSpace(4)
            Text(
                text = "CPF ${Cpf.masked(state.cpf)}",
                style = MaterialTheme.typography.bodyLarge,
                color = colors.onSurfaceVariant
            )
            VSpace(16)
            Row(
                modifier = Modifier.padding(vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically
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
                onDigit = { d -> if (pin.length < 8) pin += d },
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
                        val found = state.repo.authenticate(state.cpf, pin)
                        if (found == null) {
                            // Mensagem unica: nao revela se o CPF existe.
                            state.showError(
                                "Não foi possível entrar",
                                "CPF ou senha incorretos. Tente de novo ou procure o RH."
                            )
                        } else {
                            state.employee = found
                            state.screen = Screen.FACE
                        }
                    },
                    modifier = Modifier.weight(1f)
                )
            }
        }
    )
}

// ---------------------------------------------------------------------------
// 3. Reconhecimento facial (vivacidade)
// ---------------------------------------------------------------------------

private const val PHASE_SEARCHING = 0
private const val PHASE_BLINK = 1
private const val PHASE_EYES_CLOSED = 2
private const val PHASE_DONE = 3
private const val MAX_ATTEMPTS = 3

@Composable
fun FaceScreen(state: AppState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val employee = state.employee
    if (employee == null) {
        LaunchedEffect(Unit) { state.goHome() }
        return
    }

    var granted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    var answered by remember { mutableStateOf(granted) }
    var cameraFailed by remember { mutableStateOf(!hasAnyCamera(context)) }
    var phase by remember { mutableIntStateOf(PHASE_SEARCHING) }
    var steady by remember { mutableIntStateOf(0) }
    var attempt by remember { mutableIntStateOf(1) }
    var finished by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { ok ->
        granted = ok
        answered = true
    }

    val finish: (String) -> Unit = { faceStatus ->
        if (!finished) {
            finished = true
            scope.launch {
                val punch = withContext(Dispatchers.IO) {
                    state.repo.registerPunch(employee, state.repo.isOnline(), faceStatus)
                }
                state.punch = punch
                state.pending = state.pending + 1
                state.screen = Screen.SUCCESS
            }
        }
    }

    LaunchedEffect(Unit) {
        if (!granted && !cameraFailed) launcher.launch(Manifest.permission.CAMERA)
    }

    val unavailable = cameraFailed || (answered && !granted)

    // O sistema nunca impede a marcacao: sem camera, registra com sinalizacao.
    LaunchedEffect(unavailable) {
        if (unavailable) {
            delay(2_500)
            finish(FaceStatus.CAMERA_UNAVAILABLE)
        }
    }

    // Cada tentativa dura 12 segundos; apos a terceira, registra sem validacao.
    LaunchedEffect(attempt, granted, unavailable) {
        if (granted && !unavailable) {
            delay(12_000)
            if (!finished) {
                if (attempt >= MAX_ATTEMPTS) {
                    finish(FaceStatus.NOT_VALIDATED)
                } else {
                    attempt += 1
                    phase = PHASE_SEARCHING
                    steady = 0
                }
            }
        }
    }

    val onSample: (FaceSample?) -> Unit = { sample ->
        if (!finished) {
            if (sample == null) {
                steady = 0
                if (phase == PHASE_BLINK) phase = PHASE_SEARCHING
            } else {
                val left = sample.leftEyeOpen
                val right = sample.rightEyeOpen
                val open = left != null && right != null && left > 0.6f && right > 0.6f
                val closed = left != null && right != null && left < 0.3f && right < 0.3f
                val frontal = abs(sample.yaw) < 18f && sample.faceCount == 1
                when (phase) {
                    PHASE_SEARCHING -> {
                        if (open && frontal) {
                            steady += 1
                            if (steady >= 5) phase = PHASE_BLINK
                        } else {
                            steady = 0
                        }
                    }
                    PHASE_BLINK -> if (closed) phase = PHASE_EYES_CLOSED
                    PHASE_EYES_CLOSED -> if (open) {
                        phase = PHASE_DONE
                        finish(FaceStatus.LIVENESS_OK)
                    }
                    else -> Unit
                }
            }
        }
    }

    val colors = MaterialTheme.colorScheme
    val status = LocalStatusColors.current

    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(24.dp),
        horizontalArrangement = Arrangement.spacedBy(24.dp)
    ) {
        Box(
            modifier = Modifier
                .weight(1.2f)
                .fillMaxHeight()
                .clip(MaterialTheme.shapes.large)
                .background(colors.surfaceVariant),
            contentAlignment = Alignment.Center
        ) {
            if (granted && !unavailable) {
                FaceCamera(
                    modifier = Modifier.fillMaxSize(),
                    onSample = onSample,
                    onCameraError = { cameraFailed = true }
                )
                val guide = when (phase) {
                    PHASE_SEARCHING -> colors.outline
                    PHASE_DONE -> status.success
                    else -> colors.primary
                }
                Canvas(Modifier.fillMaxSize()) {
                    val h = size.height * 0.74f
                    val w = h * 0.74f
                    drawOval(
                        color = guide,
                        topLeft = Offset((size.width - w) / 2f, (size.height - h) / 2f),
                        size = Size(w, h),
                        style = Stroke(width = 5.dp.toPx())
                    )
                }
            } else {
                Text(
                    text = if (unavailable) "Câmera indisponível" else "Aguardando permissão da câmera",
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.onSurfaceVariant
                )
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Text(
                text = "Olá, ${employee.name.substringBefore(' ')}",
                style = MaterialTheme.typography.titleLarge,
                color = colors.onSurfaceVariant
            )
            Spacer(Modifier.weight(1f))
            val title = when {
                unavailable -> "Seguindo sem validação facial"
                phase == PHASE_SEARCHING -> "Posicione o rosto dentro da área"
                phase == PHASE_DONE -> "Tudo certo"
                else -> "Agora pisque os olhos"
            }
            val detail = when {
                unavailable -> "Sua marcação será registrada e sinalizada para o RH."
                phase == PHASE_SEARCHING -> "Olhe para a câmera, de frente, com o rosto descoberto."
                phase == PHASE_DONE -> "Registrando sua marcação."
                else -> "Feche e abra os olhos uma vez, devagar."
            }
            Text(
                text = title,
                style = MaterialTheme.typography.headlineMedium,
                color = colors.onBackground
            )
            VSpace(8)
            Text(
                text = detail,
                style = MaterialTheme.typography.bodyLarge,
                color = colors.onSurfaceVariant
            )
            VSpace(20)
            if (!unavailable) {
                Text(
                    text = "Tentativa $attempt de $MAX_ATTEMPTS",
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.onSurfaceVariant
                )
            }
            Spacer(Modifier.weight(1f))
            SecondaryButton(
                text = "Cancelar",
                onClick = { if (!finished) state.goHome() },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

// ---------------------------------------------------------------------------
// 4. Confirmacao
// ---------------------------------------------------------------------------

@Composable
fun SuccessScreen(state: AppState) {
    val punch = state.punch
    if (punch == null) {
        LaunchedEffect(Unit) { state.goHome() }
        return
    }
    var seconds by remember { mutableIntStateOf(8) }
    LaunchedEffect(Unit) {
        while (seconds > 0) {
            delay(1_000)
            seconds -= 1
        }
        state.goHome()
    }

    val colors = MaterialTheme.colorScheme
    val status = LocalStatusColors.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.weight(1f))
        Box(
            modifier = Modifier
                .size(88.dp)
                .clip(CircleShape)
                .background(status.success.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center
        ) {
            Canvas(Modifier.size(40.dp)) {
                val path = Path().apply {
                    moveTo(size.width * 0.12f, size.height * 0.54f)
                    lineTo(size.width * 0.40f, size.height * 0.80f)
                    lineTo(size.width * 0.88f, size.height * 0.24f)
                }
                drawPath(
                    path = path,
                    color = status.success,
                    style = Stroke(
                        width = 5.dp.toPx(),
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round
                    )
                )
            }
        }
        VSpace(20)
        Text(
            text = "Ponto registrado",
            style = MaterialTheme.typography.headlineMedium,
            color = colors.onBackground
        )
        VSpace(4)
        Text(
            text = punch.name,
            style = MaterialTheme.typography.titleLarge,
            color = colors.onSurfaceVariant
        )
        VSpace(12)
        Text(
            text = Fmt.time(punch.markedAt),
            style = MaterialTheme.typography.displayMedium,
            color = colors.onBackground
        )
        VSpace(16)
        Column(
            modifier = Modifier.widthIn(max = 560.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (!punch.online) {
                Banner(
                    text = "Terminal sem conexão. A marcação está guardada e será enviada automaticamente.",
                    tone = status.warning
                )
            }
            if (punch.faceStatus != FaceStatus.LIVENESS_OK) {
                Banner(text = FaceStatus.label(punch.faceStatus) + ".", tone = status.warning)
            }
        }
        Spacer(Modifier.weight(1f))
        Row(
            modifier = Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            SecondaryButton(
                text = "Ver comprovante",
                onClick = { state.screen = Screen.RECEIPT },
                modifier = Modifier.weight(1f)
            )
            PrimaryButton(
                text = "Concluir",
                onClick = { state.goHome() },
                modifier = Modifier.weight(1f)
            )
        }
        VSpace(10)
        Text(
            text = "Voltando ao início em $seconds s",
            style = MaterialTheme.typography.bodySmall,
            color = colors.onSurfaceVariant
        )
    }
}

// ---------------------------------------------------------------------------
// 5. Comprovante
// ---------------------------------------------------------------------------

@Composable
fun ReceiptScreen(state: AppState) {
    val punch = state.punch
    if (punch == null) {
        LaunchedEffect(Unit) { state.goHome() }
        return
    }
    LaunchedEffect(Unit) {
        delay(30_000)
        state.goHome()
    }
    val colors = MaterialTheme.colorScheme
    val status = LocalStatusColors.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .widthIn(max = 720.dp)
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.large)
                .background(colors.surface)
                .verticalScroll(rememberScrollState())
                .padding(28.dp)
        ) {
            Text(
                text = "Comprovante de Registro de Ponto do Trabalhador",
                style = MaterialTheme.typography.headlineSmall,
                color = colors.onSurface
            )
            VSpace(12)
            Banner(
                text = "Demonstração, sem valor legal. O comprovante oficial, com NSR e " +
                    "assinatura digital, será emitido pelo serviço REP-P.",
                tone = status.warning
            )
            VSpace(16)
            ReceiptRow("Empresa", state.companyName)
            ReceiptRow("Trabalhador", punch.name)
            ReceiptRow("CPF", Cpf.masked(punch.cpf))
            ReceiptRow("Data e hora", Fmt.dateTime(punch.markedAt) + " (UTC" + Fmt.zone() + ")")
            ReceiptRow("Terminal", punch.terminal)
            ReceiptRow("Origem", if (punch.online) "Marcação on-line" else "Marcação off-line")
            ReceiptRow("Validação facial", FaceStatus.label(punch.faceStatus))
            ReceiptRow("NSR", "Atribuído pelo servidor após a sincronização")
            ReceiptRow("Identificador", punch.id, mono = true)
            ReceiptRow("Hash SHA-256", punch.hash, mono = true)
        }
        VSpace(16)
        PrimaryButton(
            text = "Concluir",
            onClick = { state.goHome() },
            modifier = Modifier
                .widthIn(max = 720.dp)
                .fillMaxWidth()
        )
    }
}

@Composable
private fun ReceiptRow(label: String, value: String, mono: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 10.dp)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                modifier = Modifier.weight(0.34f)
            )
            Text(
                text = value,
                style = if (mono) {
                    MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
                } else {
                    MaterialTheme.typography.bodyLarge
                },
                color = colors.onSurface,
                modifier = Modifier.weight(0.66f)
            )
        }
        HorizontalDivider(color = colors.outlineVariant)
    }
}

// ---------------------------------------------------------------------------
// 6. Erros e orientacoes
// ---------------------------------------------------------------------------

@Composable
fun ErrorScreen(state: AppState) {
    LaunchedEffect(Unit) {
        delay(8_000)
        state.goHome()
    }
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.weight(1f))
        Box(
            modifier = Modifier
                .size(88.dp)
                .clip(CircleShape)
                .background(colors.error.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center
        ) {
            Canvas(Modifier.size(36.dp)) {
                val stroke = Stroke(width = 5.dp.toPx(), cap = StrokeCap.Round)
                val a = Path().apply {
                    moveTo(size.width * 0.18f, size.height * 0.18f)
                    lineTo(size.width * 0.82f, size.height * 0.82f)
                }
                val b = Path().apply {
                    moveTo(size.width * 0.82f, size.height * 0.18f)
                    lineTo(size.width * 0.18f, size.height * 0.82f)
                }
                drawPath(a, colors.error, style = stroke)
                drawPath(b, colors.error, style = stroke)
            }
        }
        VSpace(20)
        Text(
            text = state.errorTitle,
            style = MaterialTheme.typography.headlineMedium,
            color = colors.onBackground,
            textAlign = TextAlign.Center
        )
        VSpace(8)
        Text(
            text = state.errorMessage,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 520.dp)
        )
        Spacer(Modifier.weight(1f))
        PrimaryButton(
            text = "Tentar de novo",
            onClick = { state.goHome() },
            modifier = Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth()
        )
    }
}
