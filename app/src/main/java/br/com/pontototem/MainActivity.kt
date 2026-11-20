package br.com.pontototem

import android.Manifest
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import br.com.pontototem.data.LocationTracker
import br.com.pontototem.data.Repo
import br.com.pontototem.data.Settings
import br.com.pontototem.kiosk.Kiosk
import br.com.pontototem.ui.AdminPinScreen
import br.com.pontototem.ui.AdminScreen
import br.com.pontototem.ui.AppState
import br.com.pontototem.ui.EmployeeFormScreen
import br.com.pontototem.ui.EmployeesScreen
import br.com.pontototem.ui.EnrollScreen
import br.com.pontototem.ui.ErrorScreen
import br.com.pontototem.ui.FaceTestScreen
import br.com.pontototem.ui.FiscalScreen
import br.com.pontototem.ui.SetupScreen
import br.com.pontototem.ui.FaceScreen
import br.com.pontototem.ui.HomeScreen
import br.com.pontototem.ui.PasswordScreen
import br.com.pontototem.ui.PontoTheme
import br.com.pontototem.ui.ReceiptScreen
import br.com.pontototem.ui.Screen
import br.com.pontototem.ui.SuccessScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private lateinit var settings: Settings

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(applicationContext)
        val repo = Repo(applicationContext, settings)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()

        setContent {
            val state = remember { AppState(repo, settings) }

            // Localizacao do terminal: pede a permissao uma vez e passa a acompanhar a posicao.
            val locationLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestMultiplePermissions()
            ) { _ ->
                LocationTracker.start(applicationContext)
            }
            LaunchedEffect(Unit) {
                if (!LocationTracker.hasPermission(applicationContext)) {
                    locationLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                }
            }

            // Conexao, fila pendente e envio automatico a cada 5 segundos.
            LaunchedEffect(Unit) {
                var tick = 0
                while (true) {
                    val online = withContext(Dispatchers.IO) { repo.isOnline() }
                    if (online) {
                        withContext(Dispatchers.IO) { repo.syncPending(false) }
                        // Cadastro de funcionarios: ao abrir e depois a cada minuto.
                        if (tick % 12 == 0) {
                            withContext(Dispatchers.IO) { repo.syncEmployees(false) }
                        }
                    }
                    tick += 1
                    state.online = online
                    state.pending = withContext(Dispatchers.IO) { repo.pendingCount() }
                    state.employeeCount = withContext(Dispatchers.IO) { repo.employeeCount() }
                    delay(5_000)
                }
            }

            // O botao voltar nunca fecha o totem; apenas retorna ao inicio.
            BackHandler(enabled = true) {
                when (state.screen) {
                    Screen.HOME, Screen.SETUP -> Unit
                    Screen.EMPLOYEES -> state.screen = Screen.ADMIN
                    Screen.EMPLOYEE_FORM -> state.screen = Screen.EMPLOYEES
                    Screen.ENROLL, Screen.FACE_TEST -> state.screen = Screen.EMPLOYEE_FORM
                    else -> state.goHome()
                }
            }

            PontoTheme(mode = state.themeMode) {
                when (state.screen) {
                    Screen.SETUP -> SetupScreen(state)
                    Screen.EMPLOYEES -> EmployeesScreen(state)
                    Screen.EMPLOYEE_FORM -> EmployeeFormScreen(state)
                    Screen.ENROLL -> EnrollScreen(state)
                    Screen.FACE_TEST -> FaceTestScreen(state)
                    Screen.HOME -> HomeScreen(state)
                    Screen.PASSWORD -> PasswordScreen(state)
                    Screen.FACE -> FaceScreen(state)
                    Screen.SUCCESS -> SuccessScreen(state)
                    Screen.RECEIPT -> ReceiptScreen(state)
                    Screen.ERROR -> ErrorScreen(state)
                    Screen.ADMIN_PIN -> AdminPinScreen(state)
                    Screen.FISCAL -> FiscalScreen(state)
                    Screen.ADMIN -> AdminScreen(
                        state = state,
                        onKioskChanged = { on ->
                            if (on) Kiosk.lock(this@MainActivity) else Kiosk.unlock(this@MainActivity)
                        },
                        onCloseApp = {
                            Kiosk.unlock(this@MainActivity)
                            finishAndRemoveTask()
                        }
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        if (settings.kioskLock) Kiosk.lock(this)
        LocationTracker.start(applicationContext)
    }

    override fun onPause() {
        super.onPause()
        LocationTracker.stop(applicationContext)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }
}
