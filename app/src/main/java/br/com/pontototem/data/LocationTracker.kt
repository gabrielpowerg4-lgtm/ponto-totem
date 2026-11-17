package br.com.pontototem.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat

/** Uma posicao do terminal: coordenadas, precisao em metros e idade da leitura. */
class GeoFix(val latitude: Double, val longitude: Double, val accuracyM: Float, val ageMs: Long)

/**
 * Mantem a ultima posicao conhecida do tablet enquanto o app esta aberto.
 * A marcacao nunca espera pelo GPS: usa a leitura mais recente, se houver.
 */
object LocationTracker {
    private const val MAX_AGE_MS = 15L * 60L * 1000L

    @Volatile
    private var last: Location? = null
    private var listening = false

    // Classe explicita: em Android 10 todos os metodos da interface sao obrigatorios.
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            consider(location)
        }

        @Deprecated("Exigido em versoes antigas do Android")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {
        }

        override fun onProviderEnabled(provider: String) {
        }

        override fun onProviderDisabled(provider: String) {
        }
    }

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    @Synchronized
    fun start(context: Context) {
        if (listening || !hasPermission(context)) return
        val manager = context.applicationContext.getSystemService(Context.LOCATION_SERVICE)
            as? LocationManager ?: return
        val providers = try {
            manager.allProviders
        } catch (e: Exception) {
            emptyList<String>()
        }
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (!providers.contains(provider)) continue
            try {
                manager.getLastKnownLocation(provider)?.let { consider(it) }
                manager.requestLocationUpdates(provider, 60_000L, 0f, listener, Looper.getMainLooper())
                listening = true
            } catch (e: Exception) {
                // Provedor indisponivel neste aparelho.
            }
        }
    }

    @Synchronized
    fun stop(context: Context) {
        if (!listening) return
        val manager = context.applicationContext.getSystemService(Context.LOCATION_SERVICE)
            as? LocationManager
        try {
            manager?.removeUpdates(listener)
        } catch (e: Exception) {
            // Ja removido.
        }
        listening = false
    }

    private fun ageOf(location: Location): Long =
        (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000L

    /** Fica com a leitura nova se for mais precisa, ou se a anterior ja estiver velha. */
    private fun consider(location: Location) {
        val current = last
        if (current == null ||
            location.accuracy <= current.accuracy ||
            ageOf(current) - ageOf(location) > 120_000L
        ) {
            last = location
        }
    }

    /** Ultima posicao, se tiver menos de 15 minutos. */
    fun current(): GeoFix? {
        val location = last ?: return null
        val age = ageOf(location)
        if (age < 0 || age > MAX_AGE_MS) return null
        return GeoFix(location.latitude, location.longitude, location.accuracy, age)
    }
}
