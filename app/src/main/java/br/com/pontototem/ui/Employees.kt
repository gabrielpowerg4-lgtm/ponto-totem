package br.com.pontototem.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import br.com.pontototem.data.Cpf
import br.com.pontototem.data.Employee
import br.com.pontototem.data.FaceStatus
import java.util.Locale
import br.com.pontototem.data.Fmt
import br.com.pontototem.face.FaceCamera
import br.com.pontototem.face.FaceSample
import br.com.pontototem.face.hasAnyCamera
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.abs

// ---------------------------------------------------------------------------
// Lista de funcionarios da obra
// ---------------------------------------------------------------------------

@Composable
fun EmployeesScreen(state: AppState) {
    val colors = MaterialTheme.colorScheme
    val status = LocalStatusColors.current
    var list by remember { mutableStateOf(emptyList<Employee>()) }
    var loaded by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        list = withContext(Dispatchers.IO) { state.repo.employees() }
        loaded = true
    }

    FormPage {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "Funcionários",
                    style = MaterialTheme.typography.headlineMedium,
                    color = colors.onBackground
                )
                Text(
                    text = state.siteName,
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.onSurfaceVariant
                )
            }
            SecondaryButton(text = "Voltar", onClick = { state.screen = Screen.ADMIN })
        }
        VSpace(16)
        PrimaryButton(
            text = "Cadastrar funcionário",
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                state.editingId = null
                state.formMessage = ""
                state.screen = Screen.EMPLOYEE_FORM
            }
        )
        VSpace(20)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .background(colors.surface)
        ) {
            if (loaded && list.isEmpty()) {
                Text(
                    text = "Nenhum funcionário cadastrado nesta obra.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.onSurfaceVariant,
                    modifier = Modifier.padding(18.dp)
                )
            }
            for ((i, e) in list.withIndex()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            state.editingId = e.id
                            state.formMessage = ""
                            state.screen = Screen.EMPLOYEE_FORM
                        }
                        .padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = e.name,
                            style = MaterialTheme.typography.bodyLarge,
                            color = colors.onSurface
                        )
                        Text(
                            text = "CPF ${Cpf.masked(e.cpf)}" + (if (e.active) "" else " · inativo"),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant
                        )
                    }
                    Text(
                        text = if (e.hasFace) "Foto cadastrada" else "Sem foto",
                        style = MaterialTheme.typography.labelMedium,
                        color = if (e.hasFace) status.success else status.warning
                    )
                }
                if (i < list.size - 1) HorizontalDivider(color = colors.outlineVariant)
            }
        }
        VSpace(24)
    }
}

// ---------------------------------------------------------------------------
// Cadastro e atualizacao de um funcionario
// ---------------------------------------------------------------------------

@Composable
fun EmployeeFormScreen(state: AppState) {
    val colors = MaterialTheme.colorScheme
    val status = LocalStatusColors.current
    val scope = rememberCoroutineScope()

    var current by remember { mutableStateOf<Employee?>(null) }
    var name by remember { mutableStateOf("") }
    var cpf by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var active by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(state.editingId) {
        val id = state.editingId
        if (id != null) {
            val e = withContext(Dispatchers.IO) { state.repo.employee(id) }
            if (e != null) {
                current = e
                name = e.name
                cpf = e.cpf
                email = e.email
                active = e.active
            }
        }
    }

    FormPage {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = if (state.editingId == null) "Novo funcionário" else "Dados do funcionário",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.onBackground,
                modifier = Modifier.weight(1f)
            )
            SecondaryButton(text = "Voltar", onClick = { state.screen = Screen.EMPLOYEES })
        }
        VSpace(20)
        Field("Nome completo", name, { name = it })
        VSpace(12)
        Field(
            "CPF (somente números)", cpf,
            { cpf = it.filter { c -> c.isDigit() }.take(11) },
            keyboard = KeyboardType.Number
        )
        VSpace(12)
        Field(
            "E-mail", email, { email = it.trim() },
            keyboard = KeyboardType.Email,
            supporting = "O comprovante de cada marcação é enviado para este endereço."
        )
        VSpace(12)
        Field(
            if (state.editingId == null) "Senha de ponto (4 a 8 números)" else "Nova senha de ponto (opcional)",
            pin,
            { pin = it.filter { c -> c.isDigit() }.take(8) },
            keyboard = KeyboardType.NumberPassword, secret = true,
            supporting = if (state.editingId == null) null else "Deixe em branco para manter a senha atual."
        )
        VSpace(8)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "Habilitado para registrar ponto",
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.onBackground
                )
                Text(
                    text = "Desligue quando o funcionário sair da obra. O histórico é preservado.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.onSurfaceVariant
                )
            }
            Spacer(Modifier.size(12.dp))
            Switch(checked = active, onCheckedChange = { active = it })
        }
        VSpace(16)
        if (error.isNotEmpty()) {
            Banner(text = error, tone = colors.error)
            VSpace(12)
        }
        if (state.formMessage.isNotEmpty()) {
            Banner(
                text = state.formMessage,
                tone = if (state.formMessage.startsWith("Teste não")) status.warning else status.success
            )
            VSpace(12)
        }
        PrimaryButton(
            text = if (busy) "Salvando" else "Salvar dados",
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                val isNew = state.editingId == null
                error = when {
                    name.trim().length < 3 -> "Informe o nome completo."
                    !Cpf.isValid(cpf) -> "CPF inválido. Confira os números."
                    !email.contains("@") || !email.substringAfter("@").contains(".") ->
                        "Informe um e-mail válido."
                    isNew && !isPin(pin) -> "A senha deve ter de 4 a 8 números."
                    !isNew && pin.isNotEmpty() && !isPin(pin) -> "A senha deve ter de 4 a 8 números."
                    else -> ""
                }
                if (error.isEmpty()) {
                    busy = true
                    state.formMessage = ""
                    val actor = state.actor()
                    val id = state.editingId
                    scope.launch {
                        try {
                            val saved = withContext(Dispatchers.IO) {
                                val newId = state.repo.saveEmployee(
                                    id, cpf, name.trim(), email, active, pin, actor
                                )
                                state.repo.employee(newId)
                            }
                            current = saved
                            state.editingId = saved?.id
                            pin = ""
                            state.formMessage = "Dados salvos."
                        } catch (e: IllegalArgumentException) {
                            error = e.message ?: "Não foi possível salvar."
                        } catch (e: Exception) {
                            error = "Não foi possível salvar. Tente de novo."
                        }
                        busy = false
                    }
                }
            }
        )

        VSpace(28)
        Text(
            text = "Reconhecimento facial",
            style = MaterialTheme.typography.titleMedium,
            color = colors.onSurfaceVariant
        )
        VSpace(10)
        val saved = current
        if (saved == null) {
            Text(
                text = "Salve os dados para liberar a captura da foto.",
                style = MaterialTheme.typography.bodyLarge,
                color = colors.onSurfaceVariant
            )
        } else {
            val faceAt = saved.faceAt
            Text(
                text = if (faceAt != null) {
                    "Foto de referência capturada em ${Fmt.dateTime(faceAt)}."
                } else {
                    "Ainda sem foto de referência."
                },
                style = MaterialTheme.typography.bodyLarge,
                color = colors.onBackground
            )
            VSpace(12)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PrimaryButton(
                    text = if (saved.hasFace) "Refazer foto" else "Capturar foto",
                    onClick = {
                        state.formMessage = ""
                        state.screen = Screen.ENROLL
                    },
                    modifier = Modifier.weight(1f)
                )
                SecondaryButton(
                    text = "Testar validação",
                    onClick = {
                        state.formMessage = ""
                        state.screen = Screen.FACE_TEST
                    },
                    modifier = Modifier.weight(1f)
                )
            }
        }
        VSpace(24)
    }
}

// ---------------------------------------------------------------------------
// Captura da foto de referencia
// ---------------------------------------------------------------------------

@Composable
fun EnrollScreen(state: AppState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme
    val status = LocalStatusColors.current
    val employeeId = state.editingId
    if (employeeId == null) {
        LaunchedEffect(Unit) { state.screen = Screen.EMPLOYEES }
        return
    }

    var granted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    var cameraFailed by remember { mutableStateOf(!hasAnyCamera(context)) }
    var snapshot by remember { mutableStateOf<(() -> Bitmap?)?>(null) }
    var good by remember { mutableIntStateOf(0) }
    var hint by remember { mutableStateOf("Posicione o rosto dentro da área.") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { ok ->
        granted = ok
        if (!ok) cameraFailed = true
    }
    LaunchedEffect(Unit) {
        if (!granted && !cameraFailed) launcher.launch(Manifest.permission.CAMERA)
    }

    // Criterios de qualidade: um unico rosto, de frente, com os olhos abertos.
    val onSample: (FaceSample?) -> Unit = { sample ->
        if (sample == null) {
            good = 0
            hint = "Posicione o rosto dentro da área."
        } else {
            val left = sample.leftEyeOpen
            val right = sample.rightEyeOpen
            val open = left != null && right != null && left > 0.6f && right > 0.6f
            when {
                sample.faceCount > 1 -> {
                    good = 0
                    hint = "Apenas uma pessoa deve aparecer na imagem."
                }
                abs(sample.yaw) >= 12f -> {
                    good = 0
                    hint = "Olhe de frente para a câmera."
                }
                !open -> {
                    good = 0
                    hint = "Mantenha os olhos abertos."
                }
                else -> {
                    good += 1
                    hint = "Imagem adequada. Toque em Capturar."
                }
            }
        }
    }
    val ready = good >= 4 && snapshot != null && !busy

    AdaptivePanes(
        firstWeight = 0.6f,
        secondWeight = 0.4f,
        secondCard = false,
        first = {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .clip(MaterialTheme.shapes.large)
                    .background(colors.surfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                if (granted && !cameraFailed) {
                    FaceCamera(
                        modifier = Modifier.fillMaxSize(),
                        onSample = onSample,
                        onCameraError = { cameraFailed = true },
                        onReady = { fn -> snapshot = fn }
                    )
                    FaceGuide(color = if (good >= 4) status.success else colors.outline)
                } else {
                    Text(
                        text = if (cameraFailed) "Câmera indisponível" else "Aguardando permissão da câmera",
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.onSurfaceVariant
                    )
                }
            }
        },
        second = {
            Text(
                text = "Foto de referência",
                style = MaterialTheme.typography.titleLarge,
                color = colors.onSurfaceVariant
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = if (cameraFailed) "Não foi possível usar a câmera" else hint,
                style = MaterialTheme.typography.headlineMedium,
                color = colors.onBackground
            )
            VSpace(8)
            Text(
                text = "Rosto descoberto, sem capacete, óculos escuros ou máscara, em local bem " +
                    "iluminado. Confirme que o funcionário foi informado sobre o uso da imagem " +
                    "para validar o ponto.",
                style = MaterialTheme.typography.bodyLarge,
                color = colors.onSurfaceVariant
            )
            if (error.isNotEmpty()) {
                VSpace(12)
                Banner(text = error, tone = colors.error)
            }
            Spacer(Modifier.weight(1f))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                SecondaryButton(
                    text = "Cancelar",
                    onClick = { state.screen = Screen.EMPLOYEE_FORM },
                    modifier = Modifier.weight(1f)
                )
                PrimaryButton(
                    text = if (busy) "Salvando" else "Capturar",
                    enabled = ready,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        val frame = snapshot?.invoke()
                        if (frame == null) {
                            error = "Não foi possível capturar a imagem. Tente de novo."
                        } else {
                            busy = true
                            val actor = state.actor()
                            scope.launch {
                                try {
                                    withContext(Dispatchers.IO) {
                                        state.repo.saveFace(employeeId, toJpeg(frame), actor)
                                    }
                                    state.formMessage = "Foto de referência registrada."
                                    state.screen = Screen.EMPLOYEE_FORM
                                } catch (e: Exception) {
                                    error = (e as? IllegalStateException)?.message
                                        ?: "Não foi possível salvar a foto. Tente de novo."
                                    busy = false
                                }
                            }
                        }
                    }
                )
            }
        }
    )
}

/** Reduz a imagem para no maximo 640 px no maior lado e comprime em JPEG. */
private fun toJpeg(source: Bitmap): ByteArray {
    val largest = if (source.width > source.height) source.width else source.height
    val scaled = if (largest > 640) {
        val ratio = 640f / largest
        Bitmap.createScaledBitmap(
            source, (source.width * ratio).toInt(), (source.height * ratio).toInt(), true
        )
    } else {
        source
    }
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 88, out)
    return out.toByteArray()
}

// ---------------------------------------------------------------------------
// Teste da validacao facial, sem registrar ponto
// ---------------------------------------------------------------------------

@Composable
fun FaceTestScreen(state: AppState) {
    val scope = rememberCoroutineScope()
    val employeeId = state.editingId
    if (employeeId == null) {
        LaunchedEffect(Unit) { state.screen = Screen.EMPLOYEES }
        return
    }
    FaceCheck(
        greeting = "Teste de validação facial",
        unavailableDetail = "Não foi possível usar a câmera neste teste.",
        doneDetail = "Validação concluída.",
        onCancel = { state.screen = Screen.EMPLOYEE_FORM },
        verify = { frame -> state.repo.verifyFace(employeeId, frame) },
        onResult = { faceStatus, score ->
            val actor = state.actor()
            val minimum = String.format(Locale.US, "%.2f", state.settings.faceThreshold)
            val measured = if (score == null) "" else String.format(Locale.US, "%.2f", score)
            scope.launch {
                withContext(Dispatchers.IO) {
                    state.repo.audit(
                        actor, "Teste de validação facial",
                        FaceStatus.label(faceStatus) + (if (measured.isEmpty()) "" else " · semelhança $measured")
                    )
                }
                state.formMessage = when (faceStatus) {
                    FaceStatus.FACE_MATCH ->
                        "Teste aprovado: o rosto conferiu com a foto de referência " +
                            "(semelhança $measured, mínimo $minimum)."
                    FaceStatus.FACE_MISMATCH ->
                        "Teste não aprovado: o rosto não conferiu com a foto de referência " +
                            "(semelhança $measured, mínimo $minimum). Refaça a foto ou o teste."
                    FaceStatus.NO_REFERENCE ->
                        "Teste não concluído: capture antes a foto de referência."
                    else ->
                        "Teste não aprovado: " + FaceStatus.label(faceStatus).lowercase() +
                            ". Confira a iluminação e refaça."
                }
                state.screen = Screen.EMPLOYEE_FORM
            }
        }
    )
}
