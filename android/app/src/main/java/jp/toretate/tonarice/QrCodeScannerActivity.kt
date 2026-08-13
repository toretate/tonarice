package jp.toretate.tonarice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * カメラ映像から接続先 QR コードを読み取る画面。
 */
class QrCodeScannerActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private var cameraProvider: ProcessCameraProvider? = null
    private var barcodeScanner: BarcodeScanner? = null
    private var statusText: TextView? = null
    private var resultHandled = false
    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            startCamera()
        } else {
            Toast.makeText(this, getString(R.string.scan_qr_camera_permission_denied), Toast.LENGTH_LONG).show()
            setResult(RESULT_CANCELED)
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(createScannerView())

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onDestroy() {
        cameraProvider?.unbindAll()
        barcodeScanner?.close()
        cameraExecutor.shutdown()
        super.onDestroy()
    }

    private fun createScannerView(): View {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        root.addView(
            previewView,
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        )

        val topPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(16))
            setBackgroundColor(Color.argb(180, 0, 0, 0))
        }
        val title = TextView(this).apply {
            text = getString(R.string.scan_qr_title)
            textSize = 20f
            setTextColor(Color.WHITE)
        }
        topPanel.addView(title, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        statusText = TextView(this).apply {
            text = getString(R.string.scan_qr_camera_starting)
            textSize = 14f
            setTextColor(Color.WHITE)
            setPadding(0, dp(8), 0, 0)
        }
        topPanel.addView(statusText, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        root.addView(
            topPanel,
            FrameLayout.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )

        val bottomPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(16), dp(20), dp(20))
            setBackgroundColor(Color.argb(180, 0, 0, 0))
        }
        val instruction = TextView(this).apply {
            text = getString(R.string.scan_qr_instruction)
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
        }
        bottomPanel.addView(instruction, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val cancelButton = Button(this).apply {
            text = getString(R.string.scan_qr_cancel)
            setOnClickListener {
                setResult(RESULT_CANCELED)
                finish()
            }
        }
        val cancelParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        cancelParams.topMargin = dp(12)
        bottomPanel.addView(cancelButton, cancelParams)
        val bottomParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        bottomParams.gravity = Gravity.BOTTOM
        root.addView(bottomPanel, bottomParams)

        return root
    }

    @androidx.annotation.OptIn(markerClass = [ExperimentalGetImage::class])
    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                val provider = cameraProviderFuture.get()
                cameraProvider = provider

                val options = BarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                    .build()
                val scanner = BarcodeScanning.getClient(options)
                barcodeScanner = scanner

                val preview = Preview.Builder().build().also {
                    it.surfaceProvider = previewView.surfaceProvider
                }
                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage == null || resultHandled) {
                        imageProxy.close()
                        return@setAnalyzer
                    }

                    val image = InputImage.fromMediaImage(
                        mediaImage,
                        imageProxy.imageInfo.rotationDegrees,
                    )
                    scanner.process(image)
                        .addOnSuccessListener { barcodes ->
                            val value = barcodes.firstNotNullOfOrNull { it.rawValue?.trim()?.takeIf(String::isNotEmpty) }
                            if (!value.isNullOrEmpty()) {
                                onBarcodeDetected(value)
                            }
                        }
                        .addOnFailureListener {
                            // 読み取り失敗は次のフレームで再試行する。
                        }
                        .addOnCompleteListener {
                            imageProxy.close()
                        }
                }

                provider.unbindAll()
                provider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageAnalysis,
                )
                statusText?.text = getString(R.string.scan_qr_camera_ready)
            } catch (_: Exception) {
                statusText?.text = getString(R.string.scan_qr_camera_error)
                Toast.makeText(this, getString(R.string.scan_qr_camera_error), Toast.LENGTH_LONG).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun onBarcodeDetected(value: String) {
        if (resultHandled || isFinishing || isDestroyed) {
            return
        }
        resultHandled = true
        cameraProvider?.unbindAll()
        setResult(
            RESULT_OK,
            Intent().putExtra(EXTRA_SCANNED_VALUE, value),
        )
        finish()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_SCANNED_VALUE = "scanned_value"
    }
}
