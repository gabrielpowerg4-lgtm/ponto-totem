package br.com.pontototem.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
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
import br.com.pontototem.data.AuditEntry
import br.com.pontototem.data.Cpf
import br.com.pontototem.data.Employee
import br.com.pontototem.data.FaceStatus
import br.com.pontototem.data.Notice
import br.com.pontototem.data.Fmt
import br.com.pontototem.data.LocationTracker
import br.com.pontototem.data.Punch
import br.com.pontototem.data.Role
import br.com.pontototem.data.Secrets
import br.com.pontototem.data.SyncEntry
import br.com.pontototem.data.SyncStatus
import br.com.pontototem.face.hasAnyCamera
import br.com.pontototem.kiosk.Kiosk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

// ---------------------------------------------------------------------------
// Senha da area administrativa: a senha digitada define o perfil
// ---------------------------------------------------------------------------

@Composable
fun AdminPinScreen(state: AppState) {
    var pin by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

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
            VSpace(12)
            PrimaryButton(
                text = "Entrar com CPF, senha e rosto",
                onClick = {
                    state.purpose = Purpose.ADMIN
                    state.cpf = ""
                    state.screen = Screen.HOME
                },
                modifier = Modifier
                    .widthIn(max = 460.dp)
                    .fillMaxWidth()
            )
            VSpace(6)
            Text(
                text = "Para o responsável pelo tablet e o administrador.",
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant
            )
            VSpace(20)
            Text(
                text = if (wrong) "Senha incorreta" else "Ou digite a senha técnica do administrador",
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
                    .widthIn(max = 460.dp)
                    .fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                SecondaryButton(
                    text = "Voltar",
                    onClick = { state.goHome() },
                    modifier = Modifier.weight(1f)
                )
                PrimaryButton(
                    text = if (busy) "Conferindo" else "Entrar",
                    enabled = pin.length >= 4 && !busy,
                    onClick = {
                        busy = true
                        val typed = pin
                        scope.launch {
                            val role = withContext(Dispatchers.IO) {
                                val settings = state.settings
                                // Senha tecnica: so o administrador. O responsavel entra identificado.
                                val found = if (Secrets.verify(typed, settings.adminPinHash)) Role.ADMIN else ""
                                if (found.isEmpty()) {
                                    state.repo.audit("Sistema", "Acesso administrativo negado", "")
                                } else {
                                    state.repo.audit(Role.label(found) + " (senha técnica)", "Acesso administrativo", "")
                                }
                                found
                            }
                            busy = false
                            if (role.isEmpty()) {
                                wrong = true
                                pin = ""
                            } else {
                                state.role = role
                                state.lastActivity = System.currentTimeMillis()
                                state.screen = Screen.ADMIN
                            }
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
//
// Responsavel da obra: status, sincronizacao e funcionarios.
// Administrador: tambem a configuracao do terminal, a operacao e a auditoria.
// Nenhum perfil altera ou exclui marcacoes: essa funcao nao existe no aplicativo.
// ---------------------------------------------------------------------------

@Composable
fun AdminScreen(state: AppState, onKioskChanged: (Boolean) -> Unit, onCloseApp: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme
    val status = LocalStatusColors.current
    val settings = state.settings
    val isAdmin = state.role == Role.ADMIN

    var refresh by remember { mutableIntStateOf(0) }
    var total by remember { mutableIntStateOf(0) }
    var employeeCount by remember { mutableIntStateOf(0) }
    var log by remember { mutableStateOf(emptyList<SyncEntry>()) }
    var punches by remember { mutableStateOf(emptyList<Punch>()) }
    var today by remember { mutableStateOf(emptyList<Punch>()) }
    var team by remember { mutableStateOf(emptyList<Employee>()) }
    var notices by remember { mutableStateOf(emptyList<Notice>()) }
    var noticeText by remember { mutableStateOf("") }
    var noticeAbout by remember { mutableStateOf("") }
    var noticeMessage by remember { mutableStateOf("") }
    var audit by remember { mutableStateOf(emptyList<AuditEntry>()) }

    var company by remember { mutableStateOf(settings.companyName) }
    var site by remember { mutableStateOf(settings.siteName) }
    var responsible by remember { mutableStateOf(settings.responsibleName) }
    var terminal by remember { mutableStateOf(settings.terminalId) }
    var apiUrl by remember { mutableStateOf(settings.apiUrl) }
    var faceMin by remember {
        mutableStateOf(String.format(java.util.Locale.US, "%.2f", settings.faceThreshold))
    }
    var apiToken by remember { mutableStateOf(settings.apiToken) }
    var companyKey by remember { mutableStateOf("") }
    var linking by remember { mutableStateOf(false) }
    var linkError by remember { mutableStateOf("") }
    var linkMessage by remember { mutableStateOf("") }
    var linked by remember {
        mutableStateOf(
            if (settings.isLinked && settings.linkedCompany.isNotEmpty()) {
                settings.linkedCompany + ", " + settings.linkedSite
            } else {
                ""
            }
        )
    }
    var newAdminPin by remember { mutableStateOf("") }
    var newManagerPin by remember { mutableStateOf("") }
    var configMessage by remember { mutableStateOf("") }
    var configError by remember { mutableStateOf("") }
    var simulateOffline by remember { mutableStateOf(settings.simulateOffline) }
    var kiosk by remember { mutableStateOf(settings.kioskLock) }
    var syncing by remember { mutableStateOf(false) }

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
        withContext(Dispatchers.IO) {
            val t = repo.totalCount()
            val ec = repo.employeeCount()
            val l = repo.syncLog(8)
            val p = repo.recentPunches(8)
            val a = repo.auditLog(30)
            val td = repo.todayPunches()
            val tm = repo.employees().filter { it.active }
            val nt = repo.notices(5)
            val pending = repo.pendingCount()
            val online = repo.isOnline()
            withContext(Dispatchers.Main) {
                total = t
                employeeCount = ec
                log = l
                punches = p
                audit = a
                today = td
                team = tm
                notices = nt
                state.pending = pending
                state.online = online
            }
        }
    }

    val logoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            scope.launch {
                val ok = withContext(Dispatchers.IO) {
                    try {
                        val source = context.contentResolver.openInputStream(uri).use { input ->
                            BitmapFactory.decodeStream(input)
                        }
                        if (source == null) {
                            false
                        } else {
                            val largest = if (source.width > source.height) source.width else source.height
                            val scaled = if (largest > 512) {
                                val ratio = 512f / largest
                                Bitmap.createScaledBitmap(
                                    source,
                                    (source.width * ratio).toInt(),
                                    (source.height * ratio).toInt(),
                                    true
                                )
                            } else {
                                source
                            }
                            val out = ByteArrayOutputStream()
                            scaled.compress(Bitmap.CompressFormat.PNG, 100, out)
                            state.repo.saveLogo(out.toByteArray(), Role.label(Role.ADMIN))
                            true
                        }
                    } catch (e: Exception) {
                        false
                    }
                }
                if (ok) {
                    state.logoVersion += 1
                    configError = ""
                    configMessage = "Logotipo atualizado."
                } else {
                    configMessage = ""
                    configError = "Não foi possível ler a imagem escolhida."
                }
                refresh += 1
            }
        }
    }

    FormPage {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "Área administrativa",
                    style = MaterialTheme.typography.headlineMedium,
                    color = colors.onBackground
                )
                Text(
                    text = if (state.actorName.isNotEmpty()) {
                        "${state.actorName} · ${Role.label(state.role)}"
                    } else {
                        "Perfil: ${Role.label(state.role)} (senha técnica)"
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.onSurfaceVariant
                )
            }
            SecondaryButton(text = "Sair", onClick = { state.goHome() })
        }

        VSpace(20)
        val pendingFirst = team.count { !it.hasPin || !it.hasFace }
        PrimaryButton(
            text = "Primeiro acesso e funcionários ($employeeCount)",
            modifier = Modifier.fillMaxWidth(),
            onClick = { state.screen = Screen.EMPLOYEES }
        )
        if (pendingFirst > 0) {
            VSpace(6)
            Text(
                text = "$pendingFirst funcionário(s) ainda sem senha de ponto ou sem rosto cadastrado.",
                style = MaterialTheme.typography.bodyMedium,
                color = status.warning
            )
        }

        VSpace(24)
        SectionTitle("Quem marcou hoje")
        val markedCpfs = today.map { it.cpf }.toSet()
        val missing = team.filter { it.cpf !in markedCpfs }
        Card {
            InfoRow("Marcações hoje neste tablet", today.size.toString())
            InfoRow("Funcionários que já marcaram", markedCpfs.size.toString())
            InfoRow(
                "Ainda não marcaram",
                if (missing.isEmpty()) "Ninguém" else missing.take(12).joinToString(", ") { it.name.substringBefore(' ') } +
                    (if (missing.size > 12) " e mais ${missing.size - 12}" else ""),
                last = today.isEmpty()
            )
            for ((i, p) in today.take(10).withIndex()) {
                InfoRow(
                    Fmt.time(p.markedAt) + " · " + p.name.substringBefore(' '),
                    (if (FaceStatus.isValidated(p.faceStatus)) "rosto ok" else "rosto não conferiu") +
                        (if (p.online) "" else " · off-line"),
                    last = i == minOf(today.size, 10) - 1
                )
            }
        }

        if (state.actorCpf.isNotEmpty()) {
            VSpace(24)
            SectionTitle("Avisar o RH")
            Text(
                text = "Algo que o RH precisa saber para tratar o ponto, por exemplo um funcionário que " +
                    "chegou e não conseguiu marcar. O aviso aparece nas pendências do portal.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant
            )
            VSpace(10)
            Field(
                "CPF do funcionário (opcional)", noticeAbout,
                { noticeAbout = it.filter { c -> c.isDigit() }.take(11) },
                keyboard = KeyboardType.Number
            )
            VSpace(10)
            Field("O que aconteceu", noticeText, { noticeText = it.take(500) })
            VSpace(10)
            if (noticeMessage.isNotEmpty()) {
                Banner(text = noticeMessage, tone = status.success)
                VSpace(10)
            }
            PrimaryButton(
                text = "Enviar aviso",
                enabled = noticeText.trim().length >= 3 && (noticeAbout.isEmpty() || Cpf.isValid(noticeAbout)),
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    val text = noticeText.trim()
                    val about = noticeAbout
                    val actor = state.actor()
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            state.repo.addNotice(state.actorCpf, about, text, actor)
                            state.repo.syncNotices()
                        }
                        noticeText = ""
                        noticeAbout = ""
                        noticeMessage = "Aviso registrado. Ele segue para o RH assim que houver internet."
                        refresh += 1
                    }
                }
            )
            if (notices.isNotEmpty()) {
                VSpace(12)
                Card {
                    for ((i, n) in notices.withIndex()) {
                        InfoRow(
                            Fmt.dateTime(n.at),
                            n.text + (if (n.synced) " · enviado" else " · aguardando internet"),
                            last = i == notices.size - 1
                        )
                    }
                }
            }
        }

        VSpace(24)
        SectionTitle("Status")
        Card {
            InfoRow("Empresa", settings.companyName)
            InfoRow("Obra ou local", settings.siteName.ifBlank { "Sem obra (todos os funcionários)" })
            InfoRow("Responsável cadastrado no vínculo", settings.responsibleName)
            InfoRow("Terminal", settings.terminalId)
            InfoRow("Conexão", if (state.online) "On-line" else "Off-line")
            val fix = LocationTracker.current()
            InfoRow(
                "Localização",
                when {
                    !LocationTracker.hasPermission(context) -> "Sem permissão: marcações sem coordenadas"
                    fix == null -> "Aguardando sinal"
                    else -> "Ativa, precisão de ${fix.accuracyM.toInt()} m"
                }
            )
            InfoRow("Aparelho", state.repo.deviceModel())
            InfoRow(
                "Servidor",
                when {
                    settings.apiUrl.isBlank() -> "Não configurado: as marcações ficam guardadas no aparelho"
                    linked.isEmpty() -> "Não vinculado: as marcações ficam guardadas no aparelho"
                    else -> "Vinculado a $linked"
                }
            )
            InfoRow("Marcações a enviar", state.pending.toString())
            InfoRow("Marcações no aparelho", total.toString())
            InfoRow("Câmera", if (camera) "Disponível" else "Não encontrada")
            InfoRow(
                "Modo totem",
                if (deviceOwner) "Ativo (Device Owner)" else "Parcial: app não é Device Owner"
            )
            InfoRow("Versão", version, last = true)
        }
        VSpace(12)
        SecondaryButton(
            text = if (syncing) "Enviando" else "Sincronizar agora",
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                if (!syncing) {
                    syncing = true
                    val actor = state.actor()
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            state.repo.audit(actor, "Sincronização manual", "")
                            state.repo.syncPending(true)
                            state.repo.syncEmployees(true)
                        }
                        syncing = false
                        refresh += 1
                    }
                }
            }
        )

        VSpace(24)
        SectionTitle("Histórico de sincronizações")
        Card {
            if (log.isEmpty()) {
                InfoRow("Nenhuma sincronização ainda", "", last = true)
            }
            for ((i, entry) in log.withIndex()) {
                InfoRow(
                    Fmt.dateTime(entry.at),
                    (if (entry.ok) "${entry.count} enviado(s). " else "Não enviado. ") + entry.message,
                    last = i == log.size - 1
                )
            }
        }

        VSpace(24)
        SectionTitle("Últimas marcações (somente consulta)")
        Card {
            if (punches.isEmpty()) {
                InfoRow("Nenhuma marcação ainda", "", last = true)
            }
            for ((i, p) in punches.withIndex()) {
                val sync = if (p.nsr != null) "NSR ${p.nsr}" else if (p.syncStatus == SyncStatus.SENT) "Enviado" else "Pendente"
                val origin = if (p.online) "on-line" else "off-line"
                InfoRow(
                    Fmt.dateTime(p.markedAt),
                    "${Cpf.masked(p.cpf)} · $origin · $sync",
                    last = i == punches.size - 1
                )
            }
        }

        if (isAdmin) {
            VSpace(28)
            SectionTitle("Configuração do terminal")
            Field("Empresa", company, { company = it })
            VSpace(12)
            Field(
                "Obra ou local de trabalho (opcional)", site, { site = it },
                supporting = "Ao mudar a obra, vincule o terminal de novo para o servidor registrar."
            )
            VSpace(12)
            Field("Responsável pelo dispositivo", responsible, { responsible = it })
            VSpace(12)
            Field("Identificador do terminal", terminal, { terminal = it })
            VSpace(12)
            Field(
                "Endereço do servidor REP-P", apiUrl, { apiUrl = it.trim() },
                keyboard = KeyboardType.Uri,
                supporting = "Já vem preenchido com o servidor do projeto. Em branco, nada é enviado."
            )
            VSpace(12)
            Field(
                "Semelhança mínima do rosto", faceMin,
                { faceMin = it.replace(',', '.').filter { c -> c.isDigit() || c == '.' }.take(4) },
                keyboard = KeyboardType.Decimal,
                supporting = "De 0.30 a 0.80. Padrão 0.50. Maior é mais rigoroso; use o teste de " +
                    "validação do funcionário para ver a semelhança medida."
            )
            VSpace(12)
            Field(
                "Nova senha técnica do administrador (opcional)", newAdminPin,
                { newAdminPin = it.filter { c -> c.isDigit() }.take(8) },
                keyboard = KeyboardType.NumberPassword, secret = true
            )

            VSpace(12)
            if (configError.isNotEmpty()) {
                Banner(text = configError, tone = colors.error)
                VSpace(12)
            }
            if (configMessage.isNotEmpty()) {
                Banner(text = configMessage, tone = status.success)
                VSpace(12)
            }
            PrimaryButton(
                text = "Salvar configuração",
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    configMessage = ""
                    configError = when {
                        company.isBlank() -> "Informe a empresa."
                        terminal.isBlank() -> "Informe o identificador do terminal."
                        apiUrl.isNotEmpty() && !apiUrl.startsWith("https://") ->
                            "O endereço do servidor deve começar com https://."
                        (faceMin.toFloatOrNull() ?: 0f) !in 0.30f..0.80f ->
                            "A semelhança mínima do rosto deve ficar entre 0.30 e 0.80."
                        newAdminPin.isNotEmpty() && !isPin(newAdminPin) ->
                            "A senha do administrador deve ter de 4 a 8 números."
                        newManagerPin.isNotEmpty() && !isPin(newManagerPin) ->
                            "A senha do responsável deve ter de 4 a 8 números."
                        else -> ""
                    }
                    if (configError.isEmpty()) {
                        val adminPin = newAdminPin
                        val managerPin = newManagerPin
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                settings.companyName = company.trim()
                                settings.siteName = site.trim()
                                settings.responsibleName = responsible.trim()
                                settings.terminalId = terminal.trim()
                                settings.apiUrl = apiUrl
                                settings.faceThreshold = faceMin.toFloatOrNull() ?: settings.faceThreshold
                                settings.apiToken = apiToken
                                if (adminPin.isNotEmpty()) settings.adminPinHash = Secrets.hash(adminPin)
                                if (managerPin.isNotEmpty()) settings.managerPinHash = Secrets.hash(managerPin)
                                state.repo.audit(
                                    Role.label(Role.ADMIN), "Configuração do terminal alterada",
                                    "${company.trim()} · ${site.trim()} · ${terminal.trim()}" +
                                        (if (adminPin.isNotEmpty() || managerPin.isNotEmpty()) " · senha redefinida" else "")
                                )
                            }
                            state.companyName = settings.companyName
                            state.siteName = settings.siteName
                            state.terminalId = settings.terminalId
                            newAdminPin = ""
                            newManagerPin = ""
                            configMessage = "Configuração salva."
                            refresh += 1
                        }
                    }
                }
            )

            VSpace(24)
            SectionTitle("Vinculação ao servidor")
            Text(
                text = if (linked.isNotEmpty()) {
                    "Vinculado a $linked. Para vincular de novo, informe a chave da empresa."
                } else {
                    "Ainda não vinculado. Salve a configuração acima e informe a chave da empresa: " +
                        "o servidor registra este terminal na obra indicada."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant
            )
            VSpace(12)
            Field(
                "Chave da empresa", companyKey,
                { companyKey = it.uppercase().filter { c -> c.isLetterOrDigit() || c == '-' }.take(24) },
                supporting = "Formato XXXX-XXXX-XXXX."
            )
            VSpace(12)
            if (linkError.isNotEmpty()) {
                Banner(text = linkError, tone = colors.error)
                VSpace(12)
            }
            if (linkMessage.isNotEmpty()) {
                Banner(text = linkMessage, tone = status.success)
                VSpace(12)
            }
            PrimaryButton(
                text = if (linking) "Vinculando" else "Vincular terminal",
                enabled = !linking && companyKey.length >= 8,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    linking = true
                    linkError = ""
                    linkMessage = ""
                    val key = companyKey
                    scope.launch {
                        try {
                            linkMessage = withContext(Dispatchers.IO) {
                                val message = state.repo.enroll(key, Role.label(Role.ADMIN))
                                state.repo.syncEmployees(true)
                                state.repo.syncPending(true)
                                message
                            }
                            linked = settings.linkedCompany + ", " + settings.linkedSite
                            apiToken = settings.apiToken
                            companyKey = ""
                        } catch (e: Exception) {
                            linkError = e.message ?: "Não foi possível vincular."
                        }
                        linking = false
                        refresh += 1
                    }
                }
            )

            VSpace(24)
            SectionTitle("Logotipo da empresa")
            Text(
                text = "Aparece na tela inicial. Para escolher a imagem, desligue antes a trava " +
                    "do aparelho, logo abaixo.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant
            )
            VSpace(10)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PrimaryButton(
                    text = "Escolher imagem",
                    onClick = {
                        try {
                            logoPicker.launch("image/*")
                        } catch (e: Exception) {
                            configMessage = ""
                            configError = "Não foi possível abrir a galeria neste aparelho."
                        }
                    },
                    modifier = Modifier.weight(1f)
                )
                SecondaryButton(
                    text = "Remover logotipo",
                    onClick = {
                        scope.launch {
                            withContext(Dispatchers.IO) { state.repo.removeLogo(Role.label(Role.ADMIN)) }
                            state.logoVersion += 1
                            refresh += 1
                        }
                    },
                    modifier = Modifier.weight(1f)
                )
            }

            VSpace(24)
            SectionTitle("Operação")
            Card {
                ToggleRow(
                    title = "Simular falta de internet",
                    detail = "Para testar a fila de marcações off-line.",
                    checked = simulateOffline,
                    onChange = {
                        simulateOffline = it
                        settings.simulateOffline = it
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                state.repo.audit(
                                    Role.label(Role.ADMIN), "Simulação de falta de internet",
                                    if (it) "ligada" else "desligada"
                                )
                            }
                            refresh += 1
                        }
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
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                state.repo.audit(
                                    Role.label(Role.ADMIN), "Trava do aparelho",
                                    if (it) "ligada" else "desligada"
                                )
                            }
                            refresh += 1
                        }
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

            VSpace(24)
            SectionTitle("Auditoria (últimos 30 eventos)")
            Card {
                if (audit.isEmpty()) {
                    InfoRow("Nenhum evento ainda", "", last = true)
                }
                for ((i, a) in audit.withIndex()) {
                    InfoRow(
                        Fmt.dateTime(a.at),
                        a.actor + " · " + a.action + (if (a.detail.isEmpty()) "" else " · " + a.detail),
                        last = i == audit.size - 1
                    )
                }
            }

            VSpace(24)
            SecondaryButton(
                text = "Fechar aplicativo",
                onClick = onCloseApp,
                modifier = Modifier.fillMaxWidth()
            )
        }
        VSpace(24)
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
