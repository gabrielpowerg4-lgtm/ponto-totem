package br.com.pontototem.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

data class Employee(
    val id: String,
    val cpf: String,
    val name: String,
    val email: String,
    val active: Boolean,
    val hasFace: Boolean,
    val faceAt: Long?
)

data class Punch(
    val id: String,
    val cpf: String,
    val name: String,
    val markedAt: Long,
    val terminal: String,
    val company: String,
    val site: String,
    val online: Boolean,
    val faceStatus: String,
    val prevHash: String,
    val hash: String,
    val syncStatus: String,
    val syncedAt: Long?
)

data class SyncEntry(val at: Long, val count: Int, val ok: Boolean, val message: String)

data class AuditEntry(val at: Long, val actor: String, val action: String, val detail: String)

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

object Role {
    const val ADMIN = "ADMIN"
    const val MANAGER = "RESPONSAVEL"

    fun label(role: String): String = if (role == ADMIN) "Administrador" else "Responsável da obra"
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
// Senhas: so o hash fica guardado (PBKDF2 com sal por senha)
// ---------------------------------------------------------------------------

object Secrets {
    private const val ITERATIONS = 120_000

    private fun hex(bytes: ByteArray): String {
        val sb = StringBuilder()
        for (b in bytes) sb.append(String.format("%02x", b))
        return sb.toString()
    }

    private fun unhex(text: String): ByteArray {
        val out = ByteArray(text.length / 2)
        for (i in out.indices) out[i] = text.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        return out
    }

    private fun derive(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, 256)
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    }

    fun hash(pin: String): String {
        val salt = ByteArray(16)
        SecureRandom().nextBytes(salt)
        return hex(salt) + ":" + hex(derive(pin, salt))
    }

    fun verify(pin: String, stored: String): Boolean {
        val parts = stored.split(":")
        if (parts.size != 2) return false
        return try {
            MessageDigest.isEqual(derive(pin, unhex(parts[0])), unhex(parts[1]))
        } catch (e: Exception) {
            false
        }
    }

    fun sha256(text: String): String =
        hex(MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)))
}

// ---------------------------------------------------------------------------
// Relogio: hora ancorada no relogio monotonico do aparelho
// ---------------------------------------------------------------------------

object TrustedClock {
    private var anchorWall: Long = System.currentTimeMillis()
    private var anchorElapsed: Long = SystemClock.elapsedRealtime()

    /** serverTimeMillis vem do servico REP-P a cada sincronizacao bem-sucedida. */
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
    fun iso(ms: Long): String = fmt("yyyy-MM-dd'T'HH:mm:ss.SSSXXX").format(Date(ms))
}

// ---------------------------------------------------------------------------
// Configuracoes do terminal
// ---------------------------------------------------------------------------

class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("terminal", Context.MODE_PRIVATE)

    private fun str(key: String, default: String = ""): String = prefs.getString(key, default) ?: default
    private fun put(key: String, value: String) = prefs.edit().putString(key, value).apply()

    var setupDone: Boolean
        get() = prefs.getBoolean("setup_done", false)
        set(v) = prefs.edit().putBoolean("setup_done", v).apply()

    var companyName: String
        get() = str("company")
        set(v) = put("company", v)

    var siteName: String
        get() = str("site")
        set(v) = put("site", v)

    var responsibleName: String
        get() = str("responsible")
        set(v) = put("responsible", v)

    var terminalId: String
        get() {
            val current = prefs.getString("terminal_id", null)
            if (current != null) return current
            val created = "TOTEM-" + UUID.randomUUID().toString().take(4).uppercase(Locale.ROOT)
            put("terminal_id", created)
            return created
        }
        set(v) = put("terminal_id", v)

    var apiUrl: String
        get() = str("api_url")
        set(v) = put("api_url", v)

    var apiToken: String
        get() = str("api_token")
        set(v) = put("api_token", v)

    var adminPinHash: String
        get() = str("admin_pin_hash")
        set(v) = put("admin_pin_hash", v)

    var managerPinHash: String
        get() = str("manager_pin_hash")
        set(v) = put("manager_pin_hash", v)

    var themeMode: String
        get() = str("theme", "SYSTEM")
        set(v) = put("theme", v)

    var simulateOffline: Boolean
        get() = prefs.getBoolean("simulate_offline", false)
        set(v) = prefs.edit().putBoolean("simulate_offline", v).apply()

    var kioskLock: Boolean
        get() = prefs.getBoolean("kiosk_lock", true)
        set(v) = prefs.edit().putBoolean("kiosk_lock", v).apply()
}

// ---------------------------------------------------------------------------
// Banco local
// ---------------------------------------------------------------------------

private class Db(context: Context) : SQLiteOpenHelper(context, "ponto.db", null, 2) {

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
                "synced_at INTEGER," +
                "company TEXT NOT NULL DEFAULT ''," +
                "site TEXT NOT NULL DEFAULT '')"
        )
        db.execSQL(
            "CREATE TABLE sync_log (" +
                "seq INTEGER PRIMARY KEY AUTOINCREMENT," +
                "at INTEGER NOT NULL," +
                "count INTEGER NOT NULL," +
                "ok INTEGER NOT NULL," +
                "message TEXT NOT NULL)"
        )
        createV2(db)
    }

    private fun createV2(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS employees (" +
                "id TEXT PRIMARY KEY," +
                "cpf TEXT NOT NULL UNIQUE," +
                "name TEXT NOT NULL," +
                "email TEXT NOT NULL," +
                "pin_hash TEXT NOT NULL," +
                "active INTEGER NOT NULL," +
                "face_at INTEGER," +
                "created_at INTEGER NOT NULL," +
                "updated_at INTEGER NOT NULL)"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS audit (" +
                "seq INTEGER PRIMARY KEY AUTOINCREMENT," +
                "at INTEGER NOT NULL," +
                "actor TEXT NOT NULL," +
                "action TEXT NOT NULL," +
                "detail TEXT NOT NULL)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE punches ADD COLUMN company TEXT NOT NULL DEFAULT ''")
            db.execSQL("ALTER TABLE punches ADD COLUMN site TEXT NOT NULL DEFAULT ''")
            createV2(db)
        }
    }
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

class Repo(private val context: Context, private val settings: Settings) {
    private val db = Db(context.applicationContext)
    private val faceDir = File(context.filesDir, "faces")
    private val logoFile = File(context.filesDir, "logo.png")

    // ---- Funcionarios -----------------------------------------------------

    private val employeeColumns = "id, cpf, name, email, active, face_at"

    private fun readEmployee(c: android.database.Cursor): Employee {
        val faceAt = if (c.isNull(5)) null else c.getLong(5)
        return Employee(
            id = c.getString(0),
            cpf = c.getString(1),
            name = c.getString(2),
            email = c.getString(3),
            active = c.getInt(4) == 1,
            hasFace = faceAt != null,
            faceAt = faceAt
        )
    }

    fun employees(): List<Employee> {
        val out = ArrayList<Employee>()
        db.readableDatabase.rawQuery(
            "SELECT $employeeColumns FROM employees ORDER BY name COLLATE NOCASE", null
        ).use { c ->
            while (c.moveToNext()) out.add(readEmployee(c))
        }
        return out
    }

    fun employee(id: String): Employee? {
        db.readableDatabase.rawQuery(
            "SELECT $employeeColumns FROM employees WHERE id = ?", arrayOf(id)
        ).use { c ->
            return if (c.moveToFirst()) readEmployee(c) else null
        }
    }

    /** Confere CPF e senha. Retorna null em qualquer falha, sem dizer qual. */
    fun authenticate(cpf: String, pin: String): Employee? {
        var employee: Employee? = null
        var stored = ""
        db.readableDatabase.rawQuery(
            "SELECT $employeeColumns, pin_hash FROM employees WHERE cpf = ?", arrayOf(cpf)
        ).use { c ->
            if (c.moveToFirst()) {
                employee = readEmployee(c)
                stored = c.getString(6)
            }
        }
        val found = employee
        if (found == null) {
            // Gasta o mesmo tempo de uma conferencia real.
            Secrets.verify(pin, "00:00")
            return null
        }
        if (!Secrets.verify(pin, stored)) return null
        return if (found.active) found else null
    }

    /**
     * Cria ou atualiza um funcionario. `newPin` vazio mantem a senha atual.
     * Retorna o id gravado, ou lanca IllegalArgumentException com a mensagem a exibir.
     */
    @Synchronized
    fun saveEmployee(
        id: String?,
        cpf: String,
        name: String,
        email: String,
        active: Boolean,
        newPin: String,
        actor: String
    ): String {
        val now = TrustedClock.now()
        db.readableDatabase.rawQuery(
            "SELECT id FROM employees WHERE cpf = ?", arrayOf(cpf)
        ).use { c ->
            if (c.moveToFirst() && c.getString(0) != id) {
                throw IllegalArgumentException("Já existe um funcionário com este CPF.")
            }
        }
        val values = ContentValues().apply {
            put("cpf", cpf)
            put("name", name)
            put("email", email)
            put("active", if (active) 1 else 0)
            put("updated_at", now)
        }
        if (newPin.isNotEmpty()) values.put("pin_hash", Secrets.hash(newPin))
        if (id == null) {
            if (newPin.isEmpty()) throw IllegalArgumentException("Defina uma senha para o funcionário.")
            val newId = UUID.randomUUID().toString()
            values.put("id", newId)
            values.put("created_at", now)
            db.writableDatabase.insertOrThrow("employees", null, values)
            audit(actor, "Funcionário cadastrado", Cpf.masked(cpf))
            return newId
        }
        db.writableDatabase.update("employees", values, "id = ?", arrayOf(id))
        audit(
            actor,
            "Funcionário atualizado",
            Cpf.masked(cpf) + (if (newPin.isNotEmpty()) " · senha redefinida" else "") +
                (if (!active) " · inativo" else "")
        )
        return id
    }

    /** Guarda a foto de referencia cifrada com chave do Android Keystore. */
    @Synchronized
    fun saveFace(employeeId: String, jpeg: ByteArray, actor: String) {
        faceDir.mkdirs()
        File(faceDir, "$employeeId.bin").writeBytes(FaceVault.encrypt(jpeg))
        val values = ContentValues().apply {
            put("face_at", TrustedClock.now())
            put("updated_at", TrustedClock.now())
        }
        db.writableDatabase.update("employees", values, "id = ?", arrayOf(employeeId))
        val cpf = employee(employeeId)?.cpf ?: ""
        audit(actor, "Foto de referência capturada", Cpf.masked(cpf))
    }

    fun loadFace(employeeId: String): ByteArray? {
        val file = File(faceDir, "$employeeId.bin")
        if (!file.exists()) return null
        return try {
            FaceVault.decrypt(file.readBytes())
        } catch (e: Exception) {
            null
        }
    }

    // ---- Logotipo ---------------------------------------------------------

    fun logoPath(): String? = if (logoFile.exists()) logoFile.absolutePath else null

    fun saveLogo(png: ByteArray, actor: String) {
        logoFile.writeBytes(png)
        audit(actor, "Logotipo alterado", "")
    }

    fun removeLogo(actor: String) {
        if (logoFile.exists()) logoFile.delete()
        audit(actor, "Logotipo removido", "")
    }

    // ---- Conexao ----------------------------------------------------------

    fun isOnline(): Boolean {
        if (settings.simulateOffline) return false
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    // ---- Marcacoes --------------------------------------------------------

    @Synchronized
    fun registerPunch(employee: Employee, online: Boolean, faceStatus: String): Punch {
        val id = UUID.randomUUID().toString()
        val markedAt = TrustedClock.now()
        val terminal = settings.terminalId
        val company = settings.companyName
        val site = settings.siteName
        val prev = lastHash()
        val hash = Secrets.sha256("$id|${employee.cpf}|$markedAt|$terminal|$company|$site|$prev")
        val values = ContentValues().apply {
            put("id", id)
            put("cpf", employee.cpf)
            put("name", employee.name)
            put("marked_at", markedAt)
            put("terminal", terminal)
            put("company", company)
            put("site", site)
            put("online", if (online) 1 else 0)
            put("face_status", faceStatus)
            put("prev_hash", prev)
            put("hash", hash)
            put("sync_status", SyncStatus.PENDING)
        }
        db.writableDatabase.insertOrThrow("punches", null, values)
        return Punch(
            id, employee.cpf, employee.name, markedAt, terminal, company, site, online,
            faceStatus, prev, hash, SyncStatus.PENDING, null
        )
    }

    private fun lastHash(): String {
        db.readableDatabase.rawQuery(
            "SELECT hash FROM punches ORDER BY seq DESC LIMIT 1", null
        ).use { c ->
            return if (c.moveToFirst()) c.getString(0) else ""
        }
    }

    fun pendingCount(): Int = count("SELECT COUNT(*) FROM punches WHERE sync_status = '${SyncStatus.PENDING}'")

    fun totalCount(): Int = count("SELECT COUNT(*) FROM punches")

    fun employeeCount(): Int = count("SELECT COUNT(*) FROM employees")

    private fun count(sql: String): Int {
        db.readableDatabase.rawQuery(sql, null).use { c ->
            return if (c.moveToFirst()) c.getInt(0) else 0
        }
    }

    private val punchColumns = "id, cpf, name, marked_at, terminal, company, site, online, " +
        "face_status, prev_hash, hash, sync_status, synced_at"

    private fun readPunch(c: android.database.Cursor): Punch = Punch(
        c.getString(0), c.getString(1), c.getString(2), c.getLong(3), c.getString(4),
        c.getString(5), c.getString(6), c.getInt(7) == 1, c.getString(8), c.getString(9),
        c.getString(10), c.getString(11), if (c.isNull(12)) null else c.getLong(12)
    )

    fun recentPunches(limit: Int): List<Punch> {
        val out = ArrayList<Punch>()
        db.readableDatabase.rawQuery(
            "SELECT $punchColumns FROM punches ORDER BY seq DESC LIMIT $limit", null
        ).use { c ->
            while (c.moveToNext()) out.add(readPunch(c))
        }
        return out
    }

    private fun pendingPunches(limit: Int): List<Punch> {
        val out = ArrayList<Punch>()
        db.readableDatabase.rawQuery(
            "SELECT $punchColumns FROM punches WHERE sync_status = ? ORDER BY seq ASC LIMIT $limit",
            arrayOf(SyncStatus.PENDING)
        ).use { c ->
            while (c.moveToNext()) out.add(readPunch(c))
        }
        return out
    }

    // ---- Sincronizacao ----------------------------------------------------

    /**
     * Envia a fila pendente ao servico REP-P (POST {url}/v1/punches).
     * Um registro so vira "enviado" quando o servidor confirma o recebimento.
     * Cada marcacao leva seu identificador unico, entao reenvios nao duplicam.
     * `manual` registra tambem as falhas no historico.
     */
    @Synchronized
    fun syncPending(manual: Boolean): Int {
        val batch = pendingPunches(200)
        if (batch.isEmpty()) {
            if (manual) log(0, true, "Nada a enviar.")
            return 0
        }
        val base = settings.apiUrl.trim().trimEnd('/')
        if (base.isEmpty()) {
            if (manual) log(0, false, "Servidor não configurado. ${batch.size} registro(s) aguardando.")
            return 0
        }
        if (!isOnline()) {
            if (manual) log(0, false, "Sem conexão. ${batch.size} registro(s) aguardando.")
            return 0
        }
        return try {
            val body = JSONObject()
            body.put("terminal", settings.terminalId)
            body.put("company", settings.companyName)
            body.put("site", settings.siteName)
            val items = JSONArray()
            for (p in batch) {
                val o = JSONObject()
                o.put("id", p.id)
                o.put("cpf", p.cpf)
                o.put("marked_at", Fmt.iso(p.markedAt))
                o.put("terminal", p.terminal)
                o.put("company", p.company)
                o.put("site", p.site)
                o.put("online", p.online)
                o.put("face_status", p.faceStatus)
                o.put("prev_hash", p.prevHash)
                o.put("hash", p.hash)
                items.put(o)
            }
            body.put("punches", items)

            val conn = URL("$base/v1/punches").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Authorization", "Bearer " + settings.apiToken)
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code !in 200..299) {
                conn.disconnect()
                if (manual) log(0, false, "Servidor respondeu $code.")
                return 0
            }
            val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            conn.disconnect()

            val accepted = ArrayList<String>()
            val json = JSONObject(text)
            val list = json.optJSONArray("accepted")
            if (list != null) {
                for (i in 0 until list.length()) accepted.add(list.getString(i))
            }
            val serverTime = json.optLong("server_time_ms", 0L)
            if (serverTime > 0L) TrustedClock.anchor(serverTime)

            val now = TrustedClock.now()
            val wdb = db.writableDatabase
            var sent = 0
            for (id in accepted) {
                val values = ContentValues().apply {
                    put("sync_status", SyncStatus.SENT)
                    put("synced_at", now)
                }
                sent += wdb.update(
                    "punches", values, "id = ? AND sync_status = ?",
                    arrayOf(id, SyncStatus.PENDING)
                )
            }
            log(sent, true, "Recebimento confirmado pelo servidor.")
            sent
        } catch (e: Exception) {
            if (manual) log(0, false, "Falha no envio: " + (e.message ?: e.javaClass.simpleName))
            0
        }
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

    // ---- Auditoria --------------------------------------------------------

    fun audit(actor: String, action: String, detail: String) {
        val values = ContentValues().apply {
            put("at", TrustedClock.now())
            put("actor", actor)
            put("action", action)
            put("detail", detail)
        }
        db.writableDatabase.insert("audit", null, values)
    }

    fun auditLog(limit: Int): List<AuditEntry> {
        val out = ArrayList<AuditEntry>()
        db.readableDatabase.rawQuery(
            "SELECT at, actor, action, detail FROM audit ORDER BY seq DESC LIMIT $limit", null
        ).use { c ->
            while (c.moveToNext()) {
                out.add(AuditEntry(c.getLong(0), c.getString(1), c.getString(2), c.getString(3)))
            }
        }
        return out
    }
}
