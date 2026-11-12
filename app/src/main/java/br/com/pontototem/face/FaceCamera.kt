package br.com.pontototem.face

import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.util.concurrent.Executors

/** Uma leitura do rosto em um quadro. Probabilidades vao de 0 (fechado) a 1 (aberto). */
data class FaceSample(
    val leftEyeOpen: Float?,
    val rightEyeOpen: Float?,
    val yaw: Float,
    val faceCount: Int
)

/**
 * Mostra a camera frontal e entrega uma leitura por quadro analisado:
 * `null` quando nao ha rosto. Toda a analise roda no aparelho.
 */
@Composable
fun FaceCamera(
    modifier: Modifier = Modifier,
    onSample: (FaceSample?) -> Unit,
    onCameraError: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnSample by rememberUpdatedState(onSample)
    val currentOnError by rememberUpdatedState(onCameraError)

    val previewView = remember {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }

    DisposableEffect(lifecycleOwner) {
        val executor = Executors.newSingleThreadExecutor()
        val detector = FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
                .setMinFaceSize(0.2f)
                .build()
        )
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        var disposed = false

        future.addListener({
            if (!disposed) {
                try {
                    val cameraProvider = future.get()
                    provider = cameraProvider

                    val preview = Preview.Builder().build()
                    preview.setSurfaceProvider(previewView.surfaceProvider)

                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor) { proxy ->
                        analyze(proxy, detector) { sample -> currentOnSample(sample) }
                    }

                    val selector =
                        if (cameraProvider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
                            CameraSelector.DEFAULT_FRONT_CAMERA
                        } else {
                            CameraSelector.DEFAULT_BACK_CAMERA
                        }

                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(lifecycleOwner, selector, preview, analysis)
                } catch (e: Exception) {
                    currentOnError()
                }
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            disposed = true
            try {
                provider?.unbindAll()
            } catch (e: Exception) {
                // Camera ja liberada.
            }
            detector.close()
            executor.shutdown()
        }
    }

    AndroidView(factory = { previewView }, modifier = modifier)
}

@androidx.annotation.OptIn(ExperimentalGetImage::class)
private fun analyze(
    proxy: ImageProxy,
    detector: FaceDetector,
    onResult: (FaceSample?) -> Unit
) {
    val mediaImage = proxy.image
    if (mediaImage == null) {
        proxy.close()
        return
    }
    val input = InputImage.fromMediaImage(mediaImage, proxy.imageInfo.rotationDegrees)
    detector.process(input)
        .addOnSuccessListener { faces ->
            if (faces.isEmpty()) {
                onResult(null)
            } else {
                var best = faces[0]
                for (f in faces) {
                    if (f.boundingBox.width() > best.boundingBox.width()) best = f
                }
                onResult(
                    FaceSample(
                        leftEyeOpen = best.leftEyeOpenProbability,
                        rightEyeOpen = best.rightEyeOpenProbability,
                        yaw = best.headEulerAngleY,
                        faceCount = faces.size
                    )
                )
            }
        }
        .addOnCompleteListener { proxy.close() }
}

/** Disponibilidade de camera, para o diagnostico da area administrativa. */
fun hasAnyCamera(context: android.content.Context): Boolean =
    context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)
