package br.com.pontototem.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import br.com.pontototem.face.FaceMatcher
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
    val faceAt: Long?,
    val hasPin: Boolean = true
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
    val syncedAt: Long?,
    val nsr: Long? = null,
    val serverHash: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracyM: Float? = null,
    val locationAt: Long? = null
)

class FaceMatch(val status: String, val score: Float?)

data class SyncEntry(val at: Long, val count: Int, val ok: Boolean, val message: String)

data class AuditEntry(val at: Long, val actor: String, val action: String, val detail: String)

object FaceStatus {
    const val FACE_MATCH = "ROSTO_CONFERE"
    const val FACE_MISMATCH = "ROSTO_NAO_CONFERE"
    const val NO_REFERENCE = "SEM_REFERENCIA"
    const val LIVENESS_OK = "VIVACIDADE_OK"
    const val NOT_VALIDATED = "SEM_VALIDACAO"
    const val CAMERA_UNAVAILABLE = "CAMERA_INDISPONIVEL"

    /** Rosto conferido com o cadastro (ou, em registros antigos, so a vivacidade). */
    fun isValidated(status: String): Boolean = status == FACE_MATCH || status == LIVENESS_OK

    fun label(status: String): String = when (status) {
        FACE_MATCH -> "Rosto conferido com o cadastro"
        FACE_MISMATCH -> "Rosto não conferiu com o cadastro, marcação sinalizada"
        NO_REFERENCE -> "Sem foto de referência, marcação sinalizada"
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

const val DEFAULT_FACE_THRESHOLD = 0.5f

const val DEFAULT_API_URL = "https://mplacscrqtlgxmtkcrig.supabase.co/functions/v1/rep"

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
        get() = str("api_url", DEFAULT_API_URL)
        set(v) = put("api_url", v)

    /** Empresa e obra confirmadas pelo servidor na vinculacao do terminal. */
    var linkedCompany: String
        get() = str("linked_company")
        set(v) = put("linked_company", v)

    var linkedSite: String
        get() = str("linked_site")
        set(v) = put("linked_site", v)

    /** Identificador desta instalacao do app (nao e um numero de serie do aparelho). */
    val installId: String
        get() {
            val current = prefs.getString("install_id", null)
            if (current != null) return current
            val created = UUID.randomUUID().toString()
            put("install_id", created)
            return created
        }

    val isLinked: Boolean
        get() = apiUrl.isNotBlank() && apiToken.isNotBlank()

    var apiToken: String
        get() = str("api_token")
        set(v) = put("api_token", v)

    var adminPinHash: String
        get() = str("admin_pin_hash")
        set(v) = put("admin_pin_hash", v)

    var managerPinHash: String
        get() = str("manager_pin_hash")
        set(v) = put("manager_pin_hash", v)

    /** Semelhanca minima (cosseno) para o rosto conferir com o cadastro. */
    var faceThreshold: Float
        get() = prefs.getFloat("face_threshold", DEFAULT_FACE_THRESHOLD)
        set(v) = prefs.edit().putFloat("face_threshold", v).apply()

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

private class Db(context: Context) : SQLiteOpenHelper(context, "ponto.db", null, 4) {

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
        upgradeV3(db)
        upgradeV4(db)
    }

    /** V4: posicao do terminal no momento da marcacao. */
    private fun upgradeV4(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE punches ADD COLUMN lat REAL")
        db.execSQL("ALTER TABLE punches ADD COLUMN lng REAL")
        db.execSQL("ALTER TABLE punches ADD COLUMN loc_accuracy REAL")
        db.execSQL("ALTER TABLE punches ADD COLUMN loc_at INTEGER")
    }

    /** V3: numero e hash atribuidos pelo servidor, e controle de envio do cadastro. */
    private fun upgradeV3(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE punches ADD COLUMN nsr INTEGER")
        db.execSQL("ALTER TABLE punches ADD COLUMN server_hash TEXT")
        db.execSQL("ALTER TABLE employees ADD COLUMN synced_at INTEGER")
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
        if (oldVersion < 3) upgradeV3(db)
        if (oldVersion < 4) upgradeV4(db)
    }
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

class Repo(private val context: Context, private val settings: Settings) {
    private val db = Db(context.applicationContext)
    private val faceDir = File(context.filesDir, "faces")
    private val logoFile = File(context.filesDir, "logo.png")
    private val matcher = FaceMatcher(context.applicationContext)

    // ---- Funcionarios -----------------------------------------------------

    private val employeeColumns = "id, cpf, name, email, active, face_at, (pin_hash <> '') AS has_pin"

    private fun readEmployee(c: android.database.Cursor): Employee {
        val faceAt = if (c.isNull(5)) null else c.getLong(5)
        return Employee(
            id = c.getString(0),
            cpf = c.getString(1),
            name = c.getString(2),
            email = c.getString(3),
            active = c.getInt(4) == 1,
            hasFace = faceAt != null,
            hasPin = c.getInt(6) == 1,
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
                stored = c.getString(7)
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
        // A referencia biometrica (vetor) e calculada na hora; sem rosto utilizavel, nao salva.
        val image = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
        val vector = if (image == null) null else matcher.embed(image)
        if (vector == null) {
            throw IllegalStateException(
                "Não foi possível localizar o rosto na foto. Aproxime-se, de frente, com boa luz."
            )
        }
        faceDir.mkdirs()
        File(faceDir, "$employeeId.bin").writeBytes(FaceVault.encrypt(jpeg))
        File(faceDir, "$employeeId.emb").writeBytes(FaceVault.encrypt(FaceMatcher.toBytes(vector)))
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

    /** Vetor de referencia do funcionario; para fotos antigas, calcula e guarda na primeira vez. */
    private fun referenceVector(employeeId: String): FloatArray? {
        val file = File(faceDir, "$employeeId.emb")
        if (file.exists()) {
            try {
                val stored = FaceMatcher.fromBytes(FaceVault.decrypt(file.readBytes()))
                if (stored != null) return stored
            } catch (e: Exception) {
                // Recalcula a partir da foto.
            }
        }
        val jpeg = loadFace(employeeId) ?: return null
        val image = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return null
        val vector = matcher.embed(image) ?: return null
        file.writeBytes(FaceVault.encrypt(FaceMatcher.toBytes(vector)))
        return vector
    }

    /**
     * Compara o rosto do quadro com a referencia do funcionario. Tudo no aparelho.
     * `status` vazio significa que nenhum rosto utilizavel foi achado no quadro.
     */
    fun verifyFace(employeeId: String, frame: Bitmap): FaceMatch {
        val reference: FloatArray? = try {
            referenceVector(employeeId)
        } catch (e: Exception) {
            null
        }
        if (reference == null) return FaceMatch(FaceStatus.NO_REFERENCE, null)
        val probe: FloatArray? = try {
            matcher.embed(frame)
        } catch (e: Exception) {
            null
        }
        if (probe == null) return FaceMatch("", null)
        val score = FaceMatcher.cosine(reference, probe)
        val ok = score >= settings.faceThreshold
        return FaceMatch(if (ok) FaceStatus.FACE_MATCH else FaceStatus.FACE_MISMATCH, score)
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
        // Posicao do terminal: a leitura mais recente, sem atrasar a marcacao.
        val fix = LocationTracker.current()
        val fixAt = if (fix == null) null else markedAt - fix.ageMs
        if (fix != null) {
            values.put("lat", fix.latitude)
            values.put("lng", fix.longitude)
            values.put("loc_accuracy", fix.accuracyM)
            values.put("loc_at", fixAt)
        }
        db.writableDatabase.insertOrThrow("punches", null, values)
        return Punch(
            id, employee.cpf, employee.name, markedAt, terminal, company, site, online,
            faceStatus, prev, hash, SyncStatus.PENDING, null, null, null,
            fix?.latitude, fix?.longitude, fix?.accuracyM, fixAt
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
        "face_status, prev_hash, hash, sync_status, synced_at, nsr, server_hash, " +
        "lat, lng, loc_accuracy, loc_at"

    private fun readPunch(c: android.database.Cursor): Punch = Punch(
        c.getString(0), c.getString(1), c.getString(2), c.getLong(3), c.getString(4),
        c.getString(5), c.getString(6), c.getInt(7) == 1, c.getString(8), c.getString(9),
        c.getString(10), c.getString(11), if (c.isNull(12)) null else c.getLong(12),
        if (c.isNull(13)) null else c.getLong(13),
        if (c.isNull(14)) null else c.getString(14),
        if (c.isNull(15)) null else c.getDouble(15),
        if (c.isNull(16)) null else c.getDouble(16),
        if (c.isNull(17)) null else c.getFloat(17),
        if (c.isNull(18)) null else c.getLong(18)
    )

    fun punch(id: String): Punch? {
        db.readableDatabase.rawQuery(
            "SELECT $punchColumns FROM punches WHERE id = ?", arrayOf(id)
        ).use { c ->
            return if (c.moveToFirst()) readPunch(c) else null
        }
    }

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
        if (settings.apiToken.isBlank()) {
            if (manual) log(0, false, "Terminal não vinculado ao servidor. ${batch.size} registro(s) aguardando.")
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
                if (p.latitude != null && p.longitude != null) {
                    o.put("lat", p.latitude)
                    o.put("lng", p.longitude)
                    if (p.accuracyM != null) o.put("accuracy_m", p.accuracyM.toDouble())
                    if (p.locationAt != null) o.put("location_at", Fmt.iso(p.locationAt))
                }
                items.put(o)
            }
            body.put("punches", items)
            body.put("device", deviceInfo())

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
            // NSR e hash oficiais, atribuidos pelo servidor a cada marcacao.
            val nsrById = HashMap<String, Long>()
            val hashById = HashMap<String, String>()
            val receipts = json.optJSONArray("receipts")
            if (receipts != null) {
                for (i in 0 until receipts.length()) {
                    val r = receipts.getJSONObject(i)
                    nsrById[r.getString("id")] = r.getLong("nsr")
                    hashById[r.getString("id")] = r.getString("hash")
                }
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
                    nsrById[id]?.let { put("nsr", it) }
                    hashById[id]?.let { put("server_hash", it) }
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

    // ---- Servidor: chamadas, vinculacao e cadastro --------------------------

    fun deviceModel(): String =
        (android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL).trim()

    /** Dados do aparelho enviados ao servidor para auditoria. */
    private fun deviceInfo(): JSONObject {
        val version = try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
        } catch (e: Exception) {
            ""
        }
        val o = JSONObject()
        o.put("model", deviceModel())
        o.put("os", "Android " + android.os.Build.VERSION.RELEASE + " (API " + android.os.Build.VERSION.SDK_INT + ")")
        o.put("app_version", version)
        o.put("install_id", settings.installId)
        return o
    }

    private class HttpResult(val code: Int, val body: String)

    private fun call(method: String, path: String, body: JSONObject?, token: String?): HttpResult {
        val base = settings.apiUrl.trim().trimEnd('/')
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = 20_000
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return HttpResult(code, text)
        } finally {
            conn.disconnect()
        }
    }

    // ---- Arquivos fiscais (AFD e AEJ) --------------------------------------

    private fun serverMessage(result: HttpResult): String {
        val code = try {
            JSONObject(result.body).optString("error", "")
        } catch (e: Exception) {
            ""
        }
        return when (code) {
            "invalid_token" -> "Terminal não vinculado ao servidor. Vincule na área administrativa."
            "invalid_employer_id" -> "Informe um CNPJ com 14 números ou um CPF com 11 números."
            "missing_fields" -> "Informe a razão social ou o nome do empregador."
            "invalid_cno" -> "O CNO deve ter 12 números, ou ficar em branco."
            "invalid_caepf" -> "O CAEPF deve ter 14 números, ou ficar em branco."
            "invalid_responsible_cpf" -> "Informe o CPF do responsável com 11 números."
            "invalid_schedule" -> "Horário contratual inválido: use pares de entrada e saída no formato 0700."
            "invalid_period" -> "Período inválido: use datas no formato AAAA-MM-DD, de até 366 dias."
            "employer_missing" -> "Cadastre antes os dados do empregador (CNPJ ou CPF e razão social)."
            "schedule_missing" -> "Cadastre o horário contratual da obra antes de gerar o AEJ."
            else -> "O servidor respondeu ${result.code}."
        }
    }

    private fun fiscalCall(method: String, path: String, body: JSONObject?): JSONObject {
        if (!settings.isLinked) {
            throw IllegalStateException("Terminal não vinculado ao servidor. Vincule na área administrativa.")
        }
        if (!isOnline()) throw IllegalStateException("Sem conexão com a internet.")
        val result = try {
            call(method, path, body, settings.apiToken)
        } catch (e: Exception) {
            throw IllegalStateException("Não foi possível falar com o servidor.")
        }
        if (result.code !in 200..299) throw IllegalStateException(serverMessage(result))
        return JSONObject(result.body)
    }

    /** Dados do empregador, da obra, do horario contratual e do responsavel, no servidor. */
    fun loadEmployer(): JSONObject = fiscalCall("GET", "/v1/employer", null).getJSONObject("employer")

    fun saveEmployer(data: JSONObject, actor: String): JSONObject {
        val body = JSONObject()
        body.put("employer", data)
        val saved = fiscalCall("POST", "/v1/employer", body).getJSONObject("employer")
        audit(actor, "Dados do empregador salvos", saved.optString("legal_name"))
        return saved
    }

    class FiscalFile(val filename: String, val bytes: ByteArray, val records: Int, val warnings: List<String>)

    /** Gera o AFD ou o AEJ da obra no servidor. `kind`: "afd" ou "aej"; datas AAAA-MM-DD. */
    fun fiscalFile(kind: String, from: String, to: String, actor: String): FiscalFile {
        val body = JSONObject()
        body.put("kind", kind)
        body.put("from", from)
        body.put("to", to)
        val json = fiscalCall("POST", "/v1/fiscal", body)
        val warnings = ArrayList<String>()
        val list = json.optJSONArray("warnings")
        if (list != null) for (i in 0 until list.length()) warnings.add(list.getString(i))
        val bytes = android.util.Base64.decode(json.getString("content_base64"), android.util.Base64.DEFAULT)
        audit(actor, "Arquivo ${kind.uppercase(Locale.ROOT)} gerado", "$from a $to")
        return FiscalFile(json.getString("filename"), bytes, json.optInt("records", 0), warnings)
    }

    /**
     * Vincula este terminal a empresa e a obra no servidor, usando a chave da empresa.
     * Retorna a mensagem de sucesso; lanca IllegalStateException com o texto a exibir.
     */
    @Synchronized
    fun enroll(companyKey: String, actor: String): String {
        if (settings.apiUrl.isBlank()) throw IllegalStateException("Informe o endereço do servidor.")
        if (!isOnline()) throw IllegalStateException("Sem conexão com a internet.")
        val body = JSONObject()
        body.put("company_key", companyKey.trim().uppercase(Locale.ROOT))
        body.put("site", settings.siteName)
        body.put("terminal_code", settings.terminalId)
        body.put("responsible", settings.responsibleName)
        body.put("device", deviceInfo())
        val result = try {
            call("POST", "/v1/enroll", body, null)
        } catch (e: Exception) {
            throw IllegalStateException("Não foi possível falar com o servidor.")
        }
        if (result.code == 403) throw IllegalStateException("Chave da empresa incorreta.")
        if (result.code !in 200..299) {
            throw IllegalStateException("O servidor respondeu ${result.code}.")
        }
        val json = JSONObject(result.body)
        settings.apiToken = json.getString("terminal_token")
        settings.linkedCompany = json.getJSONObject("company").getString("name")
        settings.linkedSite = json.optJSONObject("site")?.optString("name", "") ?: ""
        val serverTime = json.optLong("server_time_ms", 0L)
        if (serverTime > 0L) TrustedClock.anchor(serverTime)
        val where = if (settings.linkedSite.isBlank()) "sem obra" else settings.linkedSite
        audit(actor, "Terminal vinculado ao servidor", "${settings.linkedCompany} · $where")
        return "Terminal vinculado a ${settings.linkedCompany}, $where."
    }

    /**
     * Cadastro de funcionarios nos dois sentidos: envia o que mudou neste aparelho e
     * recebe os autorizados para a obra. A foto de referencia nao sai do aparelho.
     * Retorna quantos cadastros foram recebidos ou atualizados.
     */
    @Synchronized
    fun syncEmployees(manual: Boolean): Int {
        if (!settings.isLinked || !isOnline()) return 0
        return try {
            // 1. Envia os cadastros alterados aqui.
            val changed = JSONArray()
            val sentIds = ArrayList<Pair<String, Long>>()
            db.readableDatabase.rawQuery(
                "SELECT id, cpf, name, email, pin_hash, active, updated_at FROM employees " +
                    "WHERE synced_at IS NULL OR updated_at > synced_at",
                null
            ).use { c ->
                while (c.moveToNext()) {
                    val o = JSONObject()
                    o.put("cpf", c.getString(1))
                    o.put("name", c.getString(2))
                    o.put("email", c.getString(3))
                    o.put("pin_hash", c.getString(4))
                    o.put("active", c.getInt(5) == 1)
                    o.put("updated_at_ms", c.getLong(6))
                    changed.put(o)
                    sentIds.add(Pair(c.getString(0), c.getLong(6)))
                }
            }
            if (changed.length() > 0) {
                val body = JSONObject()
                body.put("employees", changed)
                val pushed = call("POST", "/v1/employees", body, settings.apiToken)
                if (pushed.code !in 200..299) {
                    if (manual) log(0, false, "Cadastro: servidor respondeu ${pushed.code}.")
                    return 0
                }
                val wdb = db.writableDatabase
                for ((id, updatedAt) in sentIds) {
                    val values = ContentValues().apply { put("synced_at", updatedAt) }
                    wdb.update("employees", values, "id = ? AND updated_at = ?", arrayOf(id, updatedAt.toString()))
                }
            }

            // 2. Recebe os funcionarios autorizados para esta obra.
            val pulled = call("GET", "/v1/employees", null, settings.apiToken)
            if (pulled.code !in 200..299) {
                if (manual) log(0, false, "Cadastro: servidor respondeu ${pulled.code}.")
                return 0
            }
            val pulledJson = JSONObject(pulled.body)
            val serverTime = pulledJson.optLong("server_time_ms", 0L)
            if (serverTime > 0L) TrustedClock.anchor(serverTime)
            val list = pulledJson.optJSONArray("employees") ?: JSONArray()
            var merged = 0
            val wdb = db.writableDatabase
            for (i in 0 until list.length()) {
                val e = list.getJSONObject(i)
                val cpf = e.getString("cpf")
                val updatedAt = e.getLong("updated_at_ms")
                var localId: String? = null
                var localUpdated = 0L
                wdb.rawQuery("SELECT id, updated_at FROM employees WHERE cpf = ?", arrayOf(cpf)).use { c ->
                    if (c.moveToFirst()) {
                        localId = c.getString(0)
                        localUpdated = c.getLong(1)
                    }
                }
                val values = ContentValues().apply {
                    put("name", e.getString("name"))
                    put("email", e.optString("email", ""))
                    put("pin_hash", e.getString("pin_hash"))
                    put("active", if (e.optBoolean("active", true)) 1 else 0)
                    put("updated_at", updatedAt)
                    put("synced_at", updatedAt)
                }
                val existing = localId
                if (existing == null) {
                    values.put("id", UUID.randomUUID().toString())
                    values.put("cpf", cpf)
                    values.put("created_at", TrustedClock.now())
                    wdb.insertOrThrow("employees", null, values)
                    merged += 1
                } else if (updatedAt > localUpdated) {
                    wdb.update("employees", values, "id = ?", arrayOf(existing))
                    merged += 1
                }
            }
            if (manual || merged > 0 || changed.length() > 0) {
                log(
                    changed.length(), true,
                    "Cadastro: ${changed.length()} enviado(s), $merged recebido(s) ou atualizado(s)."
                )
            }
            merged
        } catch (e: Exception) {
            if (manual) log(0, false, "Cadastro: falha na sincronização: " + (e.message ?: e.javaClass.simpleName))
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
