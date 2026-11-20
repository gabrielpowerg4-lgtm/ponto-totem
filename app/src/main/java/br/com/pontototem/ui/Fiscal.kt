package br.com.pontototem.ui

import android.app.Activity
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import br.com.pontototem.data.Repo
import br.com.pontototem.data.Role
import br.com.pontototem.data.TrustedClock
import br.com.pontototem.kiosk.Kiosk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

// ---------------------------------------------------------------------------
// Arquivos fiscais: dados do empregador e geracao do AFD e do AEJ.
// Somente o perfil administrador chega aqui.
// ---------------------------------------------------------------------------

private fun isoDate(ms: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(ms))

private fun firstDayOfMonth(ms: Long): String {
    val c = Calendar.getInstance()
    c.timeInMillis = ms
    c.set(Calendar.DAY_OF_MONTH, 1)
    return isoDate(c.timeInMillis)
}

private fun onlyDigits(text: String, max: Int): String = text.filter { it.isDigit() }.take(max)

private fun validDate(text: String): Boolean {
    if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(text)) return false
    return try {
        val f = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        f.isLenient = false
        f.parse(text)
        true
    } catch (e: Exception) {
        false
    }
}

@Composable
fun FiscalScreen(state: AppState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme
    val status = LocalStatusColors.current
    val actor = Role.label(Role.ADMIN)

    if (state.role != Role.ADMIN) {
        LaunchedEffect(Unit) { state.screen = Screen.ADMIN }
        return
    }

    // Dados do empregador
    var loading by remember { mutableStateOf(true) }
    var idType by remember { mutableStateOf(1) }
    var employerId by remember { mutableStateOf("") }
    var legalName by remember { mutableStateOf("") }
    var caepf by remember { mutableStateOf("") }
    var cno by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var responsibleCpf by remember { mutableStateOf("") }
    var scheduleCode by remember { mutableStateOf("PADRAO") }
    var in1 by remember { mutableStateOf("") }
    var out1 by remember { mutableStateOf("") }
    var in2 by remember { mutableStateOf("") }
    var out2 by remember { mutableStateOf("") }
    var inpi by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var employerMessage by remember { mutableStateOf("") }
    var employerError by remember { mutableStateOf("") }

    // Geracao
    val today = TrustedClock.now()
    var from by remember { mutableStateOf(firstDayOfMonth(today)) }
    var to by remember { mutableStateOf(isoDate(today)) }
    var generating by remember { mutableStateOf("") }
    var fileError by remember { mutableStateOf("") }
    var fileMessage by remember { mutableStateOf("") }
    var warnings by remember { mutableStateOf(emptyList<String>()) }
    var pending by remember { mutableStateOf<Repo.FiscalFile?>(null) }

    fun fill(e: JSONObject) {
        idType = e.optInt("id_type", 1)
        employerId = e.optString("employer_id", "")
        legalName = e.optString("legal_name", "")
        caepf = e.optString("caepf", "")
        cno = e.optString("cno", "")
        address = e.optString("address", "")
        responsibleCpf = e.optString("responsible_cpf", "")
        scheduleCode = e.optString("schedule_code", "PADRAO").ifBlank { "PADRAO" }
        val times = e.optJSONArray("schedule_times") ?: JSONArray()
        in1 = times.optString(0, "")
        out1 = times.optString(1, "")
        in2 = times.optString(2, "")
        out2 = times.optString(3, "")
        inpi = e.optString("inpi_number", "")
    }

    LaunchedEffect(Unit) {
        try {
            val e = withContext(Dispatchers.IO) { state.repo.loadEmployer() }
            fill(e)
        } catch (e: Exception) {
            employerError = e.message ?: "Não foi possível carregar os dados do empregador."
        }
        loading = false
    }

    // Grava o arquivo no local escolhido pelo administrador.
    val saver = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/plain")
    ) { uri: Uri? ->
        val file = pending
        pending = null
        if (uri != null && file != null) {
            scope.launch {
                val ok = withContext(Dispatchers.IO) {
                    try {
                        context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(file.bytes) }
                        true
                    } catch (e: Exception) {
                        false
                    }
                }
                if (ok) {
                    fileMessage = "Arquivo ${file.filename} salvo, com ${file.records} registro(s) do período."
                } else {
                    fileError = "Não foi possível salvar o arquivo no local escolhido."
                }
            }
        } else if (file != null) {
            fileMessage = "Gravação cancelada."
        }
    }

    val generate: (String) -> Unit = { kind ->
        fileError = ""
        fileMessage = ""
        warnings = emptyList()
        when {
            !validDate(from) || !validDate(to) -> fileError = "Use datas no formato AAAA-MM-DD."
            to < from -> fileError = "A data final deve ser igual ou posterior à inicial."
            else -> {
                generating = kind
                scope.launch {
                    try {
                        val file = withContext(Dispatchers.IO) {
                            state.repo.fiscalFile(kind, from, to, actor)
                        }
                        warnings = file.warnings
                        pending = file
                        // Com o aparelho travado no app, o seletor de arquivos nao abre.
                        (context as? Activity)?.let { Kiosk.unlock(it) }
                        saver.launch(file.filename)
                    } catch (e: Exception) {
                        fileError = e.message ?: "Não foi possível gerar o arquivo."
                    }
                    generating = ""
                }
            }
        }
    }

    FormPage {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "Arquivos fiscais",
                    style = MaterialTheme.typography.headlineMedium,
                    color = colors.onBackground
                )
                Text(
                    text = "AFD e AEJ da obra ${state.siteName}",
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.onSurfaceVariant
                )
            }
            SecondaryButton(text = "Voltar", onClick = { state.screen = Screen.ADMIN })
        }

        VSpace(16)
        Banner(
            text = "Os arquivos seguem os leiautes oficiais, mas ainda saem sem assinatura digital " +
                "(.p7s). Até o certificado ICP-Brasil ser instalado, servem para conferência e não " +
                "para entrega à fiscalização.",
            tone = status.warning
        )

        // ---- Geracao ----------------------------------------------------------
        VSpace(24)
        Text(
            text = "Gerar arquivo",
            style = MaterialTheme.typography.titleMedium,
            color = colors.onSurfaceVariant
        )
        VSpace(10)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.weight(1f)) {
                Field("De (AAAA-MM-DD)", from, { from = it.take(10) }, keyboard = KeyboardType.Number)
            }
            Box(Modifier.weight(1f)) {
                Field("Até (AAAA-MM-DD)", to, { to = it.take(10) }, keyboard = KeyboardType.Number)
            }
        }
        VSpace(12)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PrimaryButton(
                text = if (generating == "afd") "Gerando AFD" else "Gerar AFD",
                enabled = generating.isEmpty(),
                onClick = { generate("afd") },
                modifier = Modifier.weight(1f)
            )
            PrimaryButton(
                text = if (generating == "aej") "Gerando AEJ" else "Gerar AEJ",
                enabled = generating.isEmpty(),
                onClick = { generate("aej") },
                modifier = Modifier.weight(1f)
            )
        }
        VSpace(8)
        Text(
            text = "AFD: todos os registros gravados no período (empresa, funcionários e marcações). " +
                "AEJ: marcações do período, organizadas em entradas e saídas.",
            style = MaterialTheme.typography.bodySmall,
            color = colors.onSurfaceVariant
        )
        if (fileError.isNotEmpty()) {
            VSpace(12)
            Banner(text = fileError, tone = colors.error)
        }
        if (fileMessage.isNotEmpty()) {
            VSpace(12)
            Banner(text = fileMessage, tone = status.success)
        }
        for (w in warnings) {
            VSpace(8)
            Banner(text = w, tone = status.warning)
        }

        // ---- Dados do empregador ----------------------------------------------
        VSpace(28)
        Text(
            text = "Dados do empregador e da obra",
            style = MaterialTheme.typography.titleMedium,
            color = colors.onSurfaceVariant
        )
        VSpace(4)
        Text(
            text = if (loading) "Carregando." else "Usados no cabeçalho dos dois arquivos. Cada alteração " +
                "fica registrada no AFD com o CPF do responsável.",
            style = MaterialTheme.typography.bodySmall,
            color = colors.onSurfaceVariant
        )
        VSpace(10)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (idType == 1) {
                PrimaryButton(text = "CNPJ", onClick = {}, modifier = Modifier.weight(1f))
                SecondaryButton(text = "CPF", onClick = { idType = 2 }, modifier = Modifier.weight(1f))
            } else {
                SecondaryButton(text = "CNPJ", onClick = { idType = 1 }, modifier = Modifier.weight(1f))
                PrimaryButton(text = "CPF", onClick = {}, modifier = Modifier.weight(1f))
            }
        }
        VSpace(12)
        Field(
            if (idType == 1) "CNPJ do empregador (14 números)" else "CPF do empregador (11 números)",
            employerId, { employerId = onlyDigits(it, if (idType == 1) 14 else 11) },
            keyboard = KeyboardType.Number
        )
        VSpace(12)
        Field("Razão social ou nome", legalName, { legalName = it.take(150) })
        VSpace(12)
        Field(
            "CNO da obra (opcional, 12 números)", cno, { cno = onlyDigits(it, 12) },
            keyboard = KeyboardType.Number,
            supporting = "Cadastro Nacional de Obras, quando a obra tiver."
        )
        if (idType == 2) {
            VSpace(12)
            Field(
                "CAEPF (opcional, 14 números)", caepf, { caepf = onlyDigits(it, 14) },
                keyboard = KeyboardType.Number
            )
        }
        VSpace(12)
        Field("Local da prestação do serviço (endereço da obra)", address, { address = it.take(100) })
        VSpace(12)
        Field(
            "CPF do responsável pelas alterações", responsibleCpf, { responsibleCpf = onlyDigits(it, 11) },
            keyboard = KeyboardType.Number,
            supporting = "Entra no AFD em cada inclusão ou alteração de empresa e de funcionário."
        )

        VSpace(20)
        Text(
            text = "Horário contratual da obra",
            style = MaterialTheme.typography.titleMedium,
            color = colors.onSurfaceVariant
        )
        VSpace(4)
        Text(
            text = "Usado no AEJ. Horas no formato 0700. O segundo par é opcional.",
            style = MaterialTheme.typography.bodySmall,
            color = colors.onSurfaceVariant
        )
        VSpace(10)
        Field("Código do horário", scheduleCode, { scheduleCode = it.take(30) })
        VSpace(12)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.weight(1f)) { Field("Entrada 1", in1, { in1 = onlyDigits(it, 4) }, keyboard = KeyboardType.Number) }
            Box(Modifier.weight(1f)) { Field("Saída 1", out1, { out1 = onlyDigits(it, 4) }, keyboard = KeyboardType.Number) }
        }
        VSpace(12)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.weight(1f)) { Field("Entrada 2", in2, { in2 = onlyDigits(it, 4) }, keyboard = KeyboardType.Number) }
            Box(Modifier.weight(1f)) { Field("Saída 2", out2, { out2 = onlyDigits(it, 4) }, keyboard = KeyboardType.Number) }
        }

        VSpace(16)
        Text(
            text = "Registro do REP-P no INPI: " + (if (inpi.isBlank()) "não cadastrado" else inpi),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.onSurfaceVariant
        )
        if (employerError.isNotEmpty()) {
            VSpace(12)
            Banner(text = employerError, tone = colors.error)
        }
        if (employerMessage.isNotEmpty()) {
            VSpace(12)
            Banner(text = employerMessage, tone = status.success)
        }
        VSpace(12)
        PrimaryButton(
            text = if (saving) "Salvando" else "Salvar dados do empregador",
            enabled = !saving && !loading,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                employerMessage = ""
                val hhmm = Regex("([01]\\d|2[0-3])[0-5]\\d")
                val second = in2.isNotEmpty() || out2.isNotEmpty()
                employerError = when {
                    idType == 1 && employerId.length != 14 -> "O CNPJ deve ter 14 números."
                    idType == 2 && employerId.length != 11 -> "O CPF do empregador deve ter 11 números."
                    legalName.isBlank() -> "Informe a razão social ou o nome."
                    cno.isNotEmpty() && cno.length != 12 -> "O CNO deve ter 12 números, ou ficar em branco."
                    responsibleCpf.length != 11 -> "Informe o CPF do responsável com 11 números."
                    !hhmm.matches(in1) || !hhmm.matches(out1) -> "Informe entrada e saída do primeiro período, como 0700."
                    second && (!hhmm.matches(in2) || !hhmm.matches(out2)) ->
                        "Complete entrada e saída do segundo período, ou deixe os dois em branco."
                    else -> ""
                }
                if (employerError.isEmpty()) {
                    val data = JSONObject()
                    data.put("id_type", idType)
                    data.put("employer_id", employerId)
                    data.put("legal_name", legalName.trim())
                    data.put("caepf", if (idType == 2) caepf else "")
                    data.put("cno", cno)
                    data.put("address", address.trim())
                    data.put("responsible_cpf", responsibleCpf)
                    data.put("schedule_code", scheduleCode.trim())
                    val times = JSONArray()
                    times.put(in1)
                    times.put(out1)
                    if (second) {
                        times.put(in2)
                        times.put(out2)
                    }
                    data.put("schedule_times", times)
                    saving = true
                    scope.launch {
                        try {
                            val saved = withContext(Dispatchers.IO) { state.repo.saveEmployer(data, actor) }
                            fill(saved)
                            employerMessage = "Dados do empregador salvos."
                        } catch (e: Exception) {
                            employerError = e.message ?: "Não foi possível salvar."
                        }
                        saving = false
                    }
                }
            }
        )
        VSpace(24)
    }
}
