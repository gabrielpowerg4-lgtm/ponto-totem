package br.com.pontototem.kiosk

import android.app.Activity
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import br.com.pontototem.MainActivity

class AdminReceiver : DeviceAdminReceiver()

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        // So abre sozinho quando o app e Device Owner; fora disso o Android bloqueia
        // a abertura de telas em segundo plano.
        if (!Kiosk.isDeviceOwner(context)) return
        val start = Intent(context, MainActivity::class.java)
        start.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(start)
        } catch (e: Exception) {
            // Sem acao: o operador abre o app manualmente.
        }
    }
}

object Kiosk {
    fun isDeviceOwner(context: Context): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return false
        return dpm.isDeviceOwnerApp(context.packageName)
    }

    /** Trava o aparelho no app. So tem efeito completo quando o app e Device Owner. */
    fun lock(activity: Activity) {
        if (!isDeviceOwner(activity)) return
        try {
            val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = ComponentName(activity, AdminReceiver::class.java)
            dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
            dpm.setPermissionGrantState(
                admin, activity.packageName, android.Manifest.permission.CAMERA,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED
            )
            activity.startLockTask()
        } catch (e: Exception) {
            // Mantem o app funcionando mesmo sem a trava.
        }
    }

    fun unlock(activity: Activity) {
        try {
            activity.stopLockTask()
        } catch (e: Exception) {
            // Nao estava travado.
        }
    }
}
