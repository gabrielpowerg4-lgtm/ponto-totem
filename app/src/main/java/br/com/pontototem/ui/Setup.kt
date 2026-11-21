package br.com.pontototem.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import br.com.pontototem.data.Secrets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Pagina de formulario: rola, respeita o teclado e limita a largura em telas grandes. */
@Composable
fun FormPage(content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .imePadding(),
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 760.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            content = content
        )
    }
}

@Composable
fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    keyboard: KeyboardType = KeyboardType.Text,
    secret: Boolean = false,
    supporting: String? = null
) {
    val support: (@Composable () -> Unit)? = if (supporting != null) {
        { Text(supporting) }
    } else {
        null
    }
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        supportingText = support
    )
}

fun isPin(text: String): Boolean = text.length in 4..8 && text.all { it.isDigit() }

// ---------------------------------------------------------------------------
// Configuracao inicial: vincula o tablet a empresa, a obra e ao responsavel
// ---------------------------------------------------------------------------

@Composable
fun SetupScreen(state: AppState) {
    val settings = state.settings
    val scope = rememberCoroutineScope()
    val colors = MaterialTheme.colorScheme

    var company by remember { mutableStateOf(settings.companyName) }
    var site by remember { mutableStateOf(settings.siteName) }
    var responsible by remember { mutableStateOf(settings.responsibleName) }
    var terminal by remember { mutableStateOf(settings.terminalId) }
    var adminPin by remember { mutableStateOf("") }
    var managerPin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    FormPage {
        Text(
            text = "Configuração inicial",
            style = MaterialTheme.typography.headlineMedium,
            color = colors.onBackground
        )
        VSpace(6)
        Text(
            text = "Vincule este tablet à empresa. A obra é opcional: informe quando o tablet " +
                "ficar em uma obra ou frente de trabalho específica.",
            style = MaterialTheme.typography.bodyLarge,
            color = colors.onSurfaceVariant
        )
        VSpace(24)
        Field("Empresa", company, { company = it })
        VSpace(12)
        Field(
            "Obra ou local de trabalho (opcional)", site, { site = it },
            supporting = "Em branco, o tablet atende todos os funcionários da empresa."
        )
        VSpace(12)
        Field("Responsável pelo dispositivo", responsible, { responsible = it })
        VSpace(12)
        Field(
            "Identificador do terminal", terminal, { terminal = it },
            supporting = "Gerado automaticamente. Altere apenas se a empresa usa um padrão próprio."
        )
        VSpace(24)
        Text(
            text = "Senhas de acesso",
            style = MaterialTheme.typography.titleMedium,
            color = colors.onSurfaceVariant
        )
        VSpace(10)
        Field(
            "Senha do administrador (4 a 8 números)", adminPin,
            { adminPin = it.filter { c -> c.isDigit() }.take(8) },
            keyboard = KeyboardType.NumberPassword, secret = true,
            supporting = "Dá acesso a toda a configuração do terminal."
        )
        VSpace(12)
        Field(
            "Senha do responsável da obra (4 a 8 números)", managerPin,
            { managerPin = it.filter { c -> c.isDigit() }.take(8) },
            keyboard = KeyboardType.NumberPassword, secret = true,
            supporting = "Dá acesso apenas ao cadastro de funcionários e ao status do terminal."
        )
        VSpace(16)
        if (error.isNotEmpty()) {
            Banner(text = error, tone = colors.error)
            VSpace(12)
        }
        PrimaryButton(
            text = if (busy) "Salvando" else "Concluir configuração",
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                error = when {
                    company.isBlank() -> "Informe a empresa."
                    responsible.isBlank() -> "Informe o responsável pelo dispositivo."
                    terminal.isBlank() -> "Informe o identificador do terminal."
                    !isPin(adminPin) -> "A senha do administrador deve ter de 4 a 8 números."
                    !isPin(managerPin) -> "A senha do responsável deve ter de 4 a 8 números."
                    adminPin == managerPin -> "As duas senhas precisam ser diferentes."
                    else -> ""
                }
                if (error.isEmpty()) {
                    busy = true
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            settings.companyName = company.trim()
                            settings.siteName = site.trim()
                            settings.responsibleName = responsible.trim()
                            settings.terminalId = terminal.trim()
                            settings.adminPinHash = Secrets.hash(adminPin)
                            settings.managerPinHash = Secrets.hash(managerPin)
                            settings.setupDone = true
                            state.repo.audit(
                                "Sistema", "Configuração inicial concluída",
                                "${company.trim()} · ${site.trim()} · ${terminal.trim()}"
                            )
                        }
                        state.companyName = settings.companyName
                        state.siteName = settings.siteName
                        state.terminalId = settings.terminalId
                        state.goHome()
                    }
                }
            }
        )
        VSpace(24)
    }
}
