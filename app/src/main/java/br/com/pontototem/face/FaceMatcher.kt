package br.com.pontototem.face

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import org.tensorflow.lite.Interpreter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/**
 * Comparacao facial no proprio aparelho.
 *
 * 1. O ML Kit localiza o rosto e os pontos dos olhos e da boca.
 * 2. O rosto e alinhado para 112 x 112 pixels, na posicao padrao do modelo.
 * 3. O MobileFaceNet (TensorFlow Lite) gera um vetor de 192 numeros.
 * 4. Dois vetores sao comparados pelo cosseno: 1 = identicos, 0 = sem relacao.
 *
 * Modelo: MobileFaceNet.tflite, de syaringan357/Android-MobileFaceNet-MTCNN-FaceAntiSpoofing
 * (licenca MIT), convertido de sirius-ai/MobileFaceNet_TF (Apache-2.0). Ver THIRD_PARTY.md.
 * Chamadas bloqueantes: usar fora da thread principal.
 */
class FaceMatcher(private val context: Context) {

    private val interpreter: Interpreter by lazy {
        val bytes = context.assets.open(MODEL).use { it.readBytes() }
        val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
        buffer.put(bytes)
        buffer.rewind()
        Interpreter(buffer, Interpreter.Options().setNumThreads(2))
    }

    private val detector: FaceDetector by lazy {
        FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                .setMinFaceSize(0.15f)
                .build()
        )
    }

    /** Vetor normalizado do maior rosto da imagem, ou null se nao houver rosto utilizavel. */
    @Synchronized
    fun embed(source: Bitmap): FloatArray? {
        val bitmap = prepare(source)
        val faces = Tasks.await(detector.process(InputImage.fromBitmap(bitmap, 0)))
        if (faces.isEmpty()) return null
        var best = faces[0]
        for (f in faces) {
            if (f.boundingBox.width() > best.boundingBox.width()) best = f
        }
        val eye1 = best.getLandmark(FaceLandmark.LEFT_EYE)?.position ?: return null
        val eye2 = best.getLandmark(FaceLandmark.RIGHT_EYE)?.position ?: return null
        val mouth1 = best.getLandmark(FaceLandmark.MOUTH_LEFT)?.position ?: return null
        val mouth2 = best.getLandmark(FaceLandmark.MOUTH_RIGHT)?.position ?: return null

        // Ordena pela posicao na imagem, para funcionar tambem com imagem espelhada.
        val eyeL = if (eye1.x <= eye2.x) eye1 else eye2
        val eyeR = if (eye1.x <= eye2.x) eye2 else eye1
        val mouthL = if (mouth1.x <= mouth2.x) mouth1 else mouth2
        val mouthR = if (mouth1.x <= mouth2.x) mouth2 else mouth1

        val aligned = align(bitmap, arrayOf(eyeL, eyeR, mouthL, mouthR))
        val pixels = IntArray(SIZE * SIZE)
        aligned.getPixels(pixels, 0, SIZE, 0, 0, SIZE, SIZE)

        // O modelo recebe sempre duas imagens; a mesma e enviada nas duas posicoes.
        val input = ByteBuffer.allocateDirect(2 * SIZE * SIZE * 3 * 4).order(ByteOrder.nativeOrder())
        for (copy in 0 until 2) {
            for (p in pixels) {
                input.putFloat((((p shr 16) and 0xFF) - 127.5f) / 128f)
                input.putFloat((((p shr 8) and 0xFF) - 127.5f) / 128f)
                input.putFloat(((p and 0xFF) - 127.5f) / 128f)
            }
        }
        input.rewind()
        val output = Array(2) { FloatArray(DIMENSIONS) }
        interpreter.run(input, output)

        val vector = output[0]
        var sum = 0.0
        for (v in vector) sum += (v * v).toDouble()
        val norm = sqrt(sum).toFloat()
        if (norm < 1e-6f) return null
        for (i in vector.indices) vector[i] = vector[i] / norm
        return vector
    }

    /** Reduz imagens grandes e garante um formato que pode ser desenhado e lido. */
    private fun prepare(source: Bitmap): Bitmap {
        val largest = if (source.width > source.height) source.width else source.height
        val scaled = if (largest > MAX_SIDE) {
            val ratio = MAX_SIDE.toFloat() / largest
            Bitmap.createScaledBitmap(
                source,
                (source.width * ratio).toInt().coerceAtLeast(1),
                (source.height * ratio).toInt().coerceAtLeast(1),
                true
            )
        } else {
            source
        }
        return if (scaled.config == Bitmap.Config.ARGB_8888) {
            scaled
        } else {
            scaled.copy(Bitmap.Config.ARGB_8888, false)
        }
    }

    /**
     * Leva olhos e cantos da boca para as posicoes padrao do modelo, com rotacao, escala
     * e deslocamento (ajuste por minimos quadrados).
     */
    private fun align(bitmap: Bitmap, points: Array<PointF>): Bitmap {
        var px = 0f
        var py = 0f
        var qx = 0f
        var qy = 0f
        for (i in points.indices) {
            px += points[i].x
            py += points[i].y
            qx += TEMPLATE[i * 2]
            qy += TEMPLATE[i * 2 + 1]
        }
        val n = points.size
        px /= n
        py /= n
        qx /= n
        qy /= n

        var dot = 0f
        var cross = 0f
        var spread = 0f
        for (i in points.indices) {
            val ax = points[i].x - px
            val ay = points[i].y - py
            val bx = TEMPLATE[i * 2] - qx
            val by = TEMPLATE[i * 2 + 1] - qy
            dot += ax * bx + ay * by
            cross += ax * by - ay * bx
            spread += ax * ax + ay * ay
        }
        val a = if (spread > 0f) dot / spread else 1f
        val b = if (spread > 0f) cross / spread else 0f
        val tx = qx - (a * px - b * py)
        val ty = qy - (b * px + a * py)

        val matrix = Matrix()
        matrix.setValues(floatArrayOf(a, -b, tx, b, a, ty, 0f, 0f, 1f))
        val out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        Canvas(out).drawBitmap(bitmap, matrix, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        return out
    }

    companion object {
        private const val MODEL = "mobilefacenet.tflite"
        private const val SIZE = 112
        private const val DIMENSIONS = 192
        private const val MAX_SIDE = 640

        // Posicoes padrao (em 112 x 112): olho esquerdo, olho direito, cantos da boca.
        private val TEMPLATE = floatArrayOf(
            38.2946f, 51.6963f,
            73.5318f, 51.5014f,
            41.5493f, 92.3655f,
            70.7299f, 92.2041f
        )

        /** Semelhanca entre dois vetores normalizados, de -1 a 1. */
        fun cosine(x: FloatArray, y: FloatArray): Float {
            if (x.size != y.size) return 0f
            var sum = 0f
            for (i in x.indices) sum += x[i] * y[i]
            return sum
        }

        fun toBytes(vector: FloatArray): ByteArray {
            val buffer = ByteBuffer.allocate(vector.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            for (v in vector) buffer.putFloat(v)
            return buffer.array()
        }

        fun fromBytes(bytes: ByteArray): FloatArray? {
            if (bytes.size != DIMENSIONS * 4) return null
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            return FloatArray(DIMENSIONS) { buffer.getFloat() }
        }
    }
}
