package br.com.pontototem.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

data class Employee(val cpf: String, val name: String, val pin: String)

data class Punch(
    val id: String,
    val cpf: String,
    val name: String,
    val markedAt: Long,
    val terminal: String,
    val online: Boolean,
    val faceStatus: String,
    val prevHash: String,
    val hash: String,
    val syncStatus: String,
    val syncedAt: Long?
)

data class SyncEntry(val at: Long, val count: Int, val ok: Boolean, val message: String)

object FaceStatus {
    const val LIVENESS_OK = "VIVACIDADE_OK"
    const val NOT_VALIDATED = "SEM_VALIDACAO"
    const val CAMERA_UNAVAILABLE = "CAMERA_INDISPONIVEL"

    fun label(status: String): String = when (status) {
        LIVENESS_OK -> "Vivacidade verificada"
        CAMERA_UNAVAILABLE -> "Câmera indisponível, marcação sinalizada"
        else -> "Sem validação biométrica, marcação sinalizada"
    }
}

object SyncStatus {
    const val PENDING = "PENDENTE"
    const val SENT = "ENVIADO"
}

// ---------------------------------------------------------------------------
// CPF
// ---------------------------------------------------------------------------

object Cpf {
    fun isValid(digits: String): Boolean {
        if (digits.length != 11 || digits.any { !it.isDigit() }) return false
        if (digits.all { it == digits[0] }) return false
        val n = digits.map { it - '0' }
        var sum = 0
        for (i in 0 until 9) sum += n[i] * (10 - i)
        var d1 = 11 - (sum % 11)
        if (d1 >= 10) d1 = 0
        if (d1 != n[9]) return false
        sum = 0
        for (i in 0 until 10) sum += n[i] * (11 - i)
        var d2 = 11 - (sum % 11)
        if (d2 >= 10) d2 = 0
        return d2 == n[10]
    }

    /** Formata os digitos ja informados, completando o restante com tracos baixos. */
    fun formatPartial(digits: String): String {
        val sb = StringBuilder()
        for (i in 0 until 11) {
            if (i == 3 || i == 6) sb.append('.')
            if (i == 9) sb.append('-')
            sb.append(if (i < digits.length) digits[i] else '_')
        }
        return sb.toString()
    }

    fun masked(digits: String): String {
        if (digits.length != 11) return digits
        return "***." + digits.substring(3, 6) + "." + digits.substring(6, 9) + "-**"
    }
}

// ---------------------------------------------------------------------------
// Relogio: hora ancorada no relogio monotonico do aparelho
// ---------------------------------------------------------------------------

object TrustedClock {
    private var anchorWall: Long = System.currentTimeMillis()
    private var anchorElapsed: Long = SystemClock.elapsedRealtime()

    /** Na versao integrada, serverTimeMillis vem do servico REP-P a cada sincronizacao. */
    fun anchor(serverTimeMillis: Long) {
        anchorWall = serverTimeMillis
        anchorElapsed = SystemClock.elapsedRealtime()
    }

    fun now(): Long = anchorWall + (SystemClock.elapsedRealtime() - anchorElapsed)
}

object Fmt {
    private fun fmt(pattern: String): SimpleDateFormat {
        val f = SimpleDateFormat(pattern, Locale("pt", "BR"))
        f.timeZone = TimeZone.getDefault()
        return f
    }

    fun time(ms: Long): String = fmt("HH:mm:ss").format(Date(ms))
    fun date(ms: Long): String = fmt("EEEE, d 'de' MMMM 'de' yyyy").format(Date(ms))
    fun dateTime(ms: Long): String = fmt("dd/MM/yyyy HH:mm:ss").format(Date(ms))
    fun zone(): String = fmt("XXX").format(Date())
}

// ---------------------------------------------------------------------------
// Configuracoes do terminal
// ---------------------------------------------------------------------------

class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("terminal", Context.MODE_PRIVATE)

    var companyName: String
        get() = prefs.getString("company", "Empresa Demonstração") ?: "Empresa Demonstração"
        set(v) = prefs.edit().putString("company", v).apply()

    var terminalId: String
        get() {
            val current = prefs.getString("terminal_id", null)
            if (current != null) return current
            val created = "TOTEM-" + UUID.randomUUID().toString().take(4).uppercase(Locale.ROOT)
            prefs.edit().putString("terminal_id", created).apply()
            return created
        }
        set(v) = prefs.edit().putString("terminal_id", v).apply()

    var apiUrl: String
        get() = prefs.getString("api_url", "") ?: ""
        set(v) = prefs.edit().putString("api_url", v).apply()

    var themeMode: String
        get() = prefs.getString("theme", "SYSTEM") ?: "SYSTEM"
        set(v) = prefs.edit().putString("theme", v).apply()

    var simulateOffline: Boolean
        get() = prefs.getBoolean("simulate_offline", false)
        set(v) = prefs.edit().putBoolean("simulate_offline", v).apply()

    var kioskLock: Boolean
        get() = prefs.getBoolean("kiosk_lock", true)
        set(v) = prefs.edit().putBoolean("kiosk_lock", v).apply()

    var adminPin: String
        get() = prefs.getString("admin_pin", "1234") ?: "1234"
        set(v) = prefs.edit().putString("admin_pin", v).apply()
}

// ---------------------------------------------------------------------------
// Banco local
// ---------------------------------------------------------------------------

private class Db(context: Context) : SQLiteOpenHelper(context, "ponto.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE punches (" +
                "seq INTEGER PRIMARY KEY AUTOINCREMENT," +
                "id TEXT NOT NULL UNIQUE," +
                "cpf TEXT NOT NULL," +
                "name TEXT NOT NULL," +
                "marked_at INTEGER NOT NULL," +
                "terminal TEXT NOT NULL," +
                "online INTEGER NOT NULL," +
                "face_status TEXT NOT NULL," +
                "prev_hash TEXT NOT NULL," +
                "hash TEXT NOT NULL," +
                "sync_status TEXT NOT NULL," +
                "synced_at INTEGER)"
        )
        db.execSQL(
            "CREATE TABLE sync_log (" +
                "seq INTEGER PRIMARY KEY AUTOINCREMENT," +
                "at INTEGER NOT NULL," +
                "count INTEGER NOT NULL," +
                "ok INTEGER NOT NULL," +
                "message TEXT NOT NULL)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Versao unica por enquanto.
    }
}

// ---------------------------------------------------------------------------
// Repositorio (modo demonstracao)
// ---------------------------------------------------------------------------

class Repo(private val context: Context, private val settings: Settings) {
    private val db = Db(context.applicationContext)

    // Funcionarios ficticios para validacao. Na versao integrada, o cadastro vem
    // do servico REP-P e a senha nunca fica em texto claro no aparelho.
    private val demoEmployees = listOf(
        Employee("11144477735", "Ana Souza", "1234"),
        Employee("52998224725", "Carlos Lima", "4321"),
        Employee("12345678909", "Marina Alves", "0000")
    )

    fun authenticate(cpf: String, pin: String): Employee? =
        demoEmployees.firstOrNull { it.cpf == cpf && it.pin == pin }

    fun isOnline(): Boolean {
        if (settings.simulateOffline) return false
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    @Synchronized
    fun registerPunch(employee: Employee, online: Boolean, faceStatus: String): Punch {
        val id = UUID.randomUUID().toString()
        val markedAt = TrustedClock.now()
        val terminal = settings.terminalId
        val prev = lastHash()
        val hash = sha256("$id|${employee.cpf}|$markedAt|$terminal|$prev")
        val values = ContentValues().apply {
            put("id", id)
            put("cpf", employee.cpf)
            put("name", employee.name)
            put("marked_at", markedAt)
            put("terminal", terminal)
            put("online", if (online) 1 else 0)
            put("face_status", faceStatus)
            put("prev_hash", prev)
            put("hash", hash)
            put("sync_status", SyncStatus.PENDING)
        }
        db.writableDatabase.insertOrThrow("punches", null, values)
        return Punch(
            id, employee.cpf, employee.name, markedAt, terminal, online, faceStatus,
            prev, hash, SyncStatus.PENDING, null
        )
    }

    private fun lastHash(): String {
        db.readableDatabase.rawQuery(
            "SELECT hash FROM punches ORDER BY seq DESC LIMIT 1", null
        ).use { c ->
            return if (c.moveToFirst()) c.getString(0) else ""
        }
    }

    fun pendingCount(): Int {
        db.readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM punches WHERE sync_status = ?", arrayOf(SyncStatus.PENDING)
        ).use { c ->
            return if (c.moveToFirst()) c.getInt(0) else 0
        }
    }

    fun totalCount(): Int {
        db.readableDatabase.rawQuery("SELECT COUNT(*) FROM punches", null).use { c ->
            return if (c.moveToFirst()) c.getInt(0) else 0
        }
    }

    fun recentPunches(limit: Int): List<Punch> {
        val out = ArrayList<Punch>()
        db.readableDatabase.rawQuery(
            "SELECT id, cpf, name, marked_at, terminal, online, face_status, prev_hash, hash, " +
                "sync_status, synced_at FROM punches ORDER BY seq DESC LIMIT $limit",
            null
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    Punch(
                        c.getString(0), c.getString(1), c.getString(2), c.getLong(3),
                        c.getString(4), c.getInt(5) == 1, c.getString(6), c.getString(7),
                        c.getString(8), c.getString(9),
                        if (c.isNull(10)) null else c.getLong(10)
                    )
                )
            }
        }
        return out
    }

    /**
     * Envia a fila pendente. No modo demonstracao o envio e simulado: os registros
     * sao marcados como enviados quando ha conexao. Retorna a quantidade enviada.
     */
    @Synchronized
    fun syncPending(): Int {
        val pending = pendingCount()
        if (pending == 0) return 0
        if (!isOnline()) {
            log(0, false, "Sem conexão. $pending registro(s) aguardando.")
            return 0
        }
        val values = ContentValues().apply {
            put("sync_status", SyncStatus.SENT)
            put("synced_at", TrustedClock.now())
        }
        val sent = db.writableDatabase.update(
            "punches", values, "sync_status = ?", arrayOf(SyncStatus.PENDING)
        )
        log(sent, true, "Envio simulado (modo demonstração).")
        return sent
    }

    private fun log(count: Int, ok: Boolean, message: String) {
        val values = ContentValues().apply {
            put("at", TrustedClock.now())
            put("count", count)
            put("ok", if (ok) 1 else 0)
            put("message", message)
        }
        db.writableDatabase.insert("sync_log", null, values)
    }

    fun syncLog(limit: Int): List<SyncEntry> {
        val out = ArrayList<SyncEntry>()
        db.readableDatabase.rawQuery(
            "SELECT at, count, ok, message FROM sync_log ORDER BY seq DESC LIMIT $limit", null
        ).use { c ->
            while (c.moveToNext()) {
                out.add(SyncEntry(c.getLong(0), c.getInt(1), c.getInt(2) == 1, c.getString(3)))
            }
        }
        return out
    }

    private fun sha256(text: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder()
        for (b in bytes) sb.append(String.format("%02x", b))
        return sb.toString()
    }
}
