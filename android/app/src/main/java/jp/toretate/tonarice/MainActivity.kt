package jp.toretate.tonarice

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * tonarice Web 版を表示する最小限の Android シェル。
 */
class MainActivity : AppCompatActivity() {
    private lateinit var contentContainer: FrameLayout
    private lateinit var settingsButton: Button
    private lateinit var preferences: ConnectionPreferences

    private var settingsEndpointInput: EditText? = null
    private var settingsValidationMessage: TextView? = null
    private var endpoint: Uri? = null
    private var webView: WebView? = null
    private var webViewEndpoint: Uri? = null
    private var progressBar: ProgressBar? = null
    private var errorPanel: View? = null
    private var uploadCallback: ValueCallback<Array<Uri>>? = null

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetMultipleContents(),
    ) { uris ->
        val callback = uploadCallback ?: return@registerForActivityResult
        uploadCallback = null
        callback.onReceiveValue(uris.takeIf { it.isNotEmpty() }?.toTypedArray())
    }

    private val qrScannerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != RESULT_OK) {
            return@registerForActivityResult
        }

        val scannedValue = result.data?.getStringExtra(QrCodeScannerActivity.EXTRA_SCANNED_VALUE).orEmpty()
        val normalizedEndpoint = UrlPolicy.normalizeEndpoint(scannedValue)
        val input = settingsEndpointInput
        val validationMessage = settingsValidationMessage
        if (normalizedEndpoint == null) {
            validationMessage?.text = getString(R.string.scan_qr_invalid_endpoint)
            validationMessage?.visibility = View.VISIBLE
            return@registerForActivityResult
        }

        input?.let {
            it.setText(normalizedEndpoint)
            it.setSelection(it.text.length)
        }
        connectToEndpoint(normalizedEndpoint, validationMessage)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        preferences = ConnectionPreferences(this)
        endpoint = savedInstanceState?.getString(KEY_ENDPOINT)?.let(UrlPolicy::normalizeEndpoint)?.let(Uri::parse)
            ?: preferences.loadEndpoint()?.let(Uri::parse)

        createShell()
        configureBackNavigation()

        if (endpoint == null) {
            showSettingsScreen()
        } else {
            showWebScreen(savedInstanceState?.getBundle(KEY_WEB_VIEW_STATE))
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(KEY_ENDPOINT, endpoint?.toString())
        webView?.let { view ->
            val webViewState = Bundle()
            view.saveState(webViewState)
            outState.putBundle(KEY_WEB_VIEW_STATE, webViewState)
        }
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        uploadCallback?.onReceiveValue(null)
        uploadCallback = null
        webView?.apply {
            stopLoading()
            webChromeClient = null
            destroy()
        }
        webView = null
        webViewEndpoint = null
        super.onDestroy()
    }

    private fun createShell() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ContextCompat.getColor(context, R.color.tonarice_background))
        }

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(8), dp(8), dp(8))
            setBackgroundColor(ContextCompat.getColor(context, R.color.tonarice_surface))
        }

        val title = TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 18f
            setTextColor(ContextCompat.getColor(context, R.color.tonarice_on_surface))
        }
        toolbar.addView(
            title,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )

        settingsButton = Button(this).apply {
            text = getString(R.string.connection_settings)
            setOnClickListener { showSettingsScreen() }
        }
        toolbar.addView(
            settingsButton,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )

        contentContainer = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(context, R.color.tonarice_background))
        }
        root.addView(toolbar, LinearLayout.LayoutParams.MATCH_PARENT, dp(64))
        root.addView(
            contentContainer,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0).apply {
                weight = 1f
            },
        )
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(view.paddingLeft, systemBars.top, view.paddingRight, systemBars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)
    }

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val currentWebView = webView
                if (currentWebView?.visibility == View.VISIBLE && currentWebView.canGoBack()) {
                    currentWebView.goBack()
                    return
                }

                if (settingsButton.isEnabled && endpoint != null) {
                    showSettingsScreen()
                } else if (endpoint != null) {
                    showWebScreen()
                } else {
                    finish()
                }
            }
        })
    }

    private fun showSettingsScreen() {
        detachWebView()
        contentContainer.removeAllViews()
        settingsButton.isEnabled = false
        settingsEndpointInput = null
        settingsValidationMessage = null

        val scrollView = ScrollView(this)
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(28), dp(24), dp(28))
        }

        val heading = TextView(this).apply {
            text = getString(R.string.connection_settings)
            textSize = 24f
            setTextColor(ContextCompat.getColor(context, R.color.tonarice_on_surface))
        }
        form.addView(heading, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val label = TextView(this).apply {
            text = getString(R.string.connection_url_label)
            setTextColor(ContextCompat.getColor(context, R.color.tonarice_on_surface))
            setPadding(0, dp(24), 0, dp(8))
        }
        form.addView(label, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val endpointInput = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            hint = getString(R.string.connection_url_hint)
            setSingleLine(true)
            setText(endpoint?.toString().orEmpty())
            setSelectAllOnFocus(false)
        }
        form.addView(endpointInput, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val scanQrButton = Button(this).apply {
            text = getString(R.string.scan_qr_code)
            setOnClickListener {
                qrScannerLauncher.launch(Intent(this@MainActivity, QrCodeScannerActivity::class.java))
            }
        }
        val scanQrParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        scanQrParams.topMargin = dp(12)
        form.addView(scanQrButton, scanQrParams)

        val validationMessage = TextView(this).apply {
            setTextColor(ContextCompat.getColor(context, R.color.tonarice_error))
            visibility = View.GONE
            setPadding(0, dp(8), 0, 0)
        }
        form.addView(validationMessage, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val historyHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(24), 0, dp(8))
        }
        val historyLabel = TextView(this).apply {
            text = getString(R.string.connection_history_label, BuildConfig.ENDPOINT_HISTORY_LIMIT)
            setTextColor(ContextCompat.getColor(context, R.color.tonarice_on_surface))
        }
        historyHeader.addView(
            historyLabel,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        form.addView(historyHeader, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val history = preferences.loadEndpointHistory()
        if (history.isEmpty()) {
            val emptyHistoryMessage = TextView(this).apply {
                text = getString(R.string.connection_history_empty)
                setTextColor(ContextCompat.getColor(context, R.color.tonarice_on_surface))
                setPadding(0, 0, 0, dp(8))
            }
            form.addView(emptyHistoryMessage, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        } else {
            history.forEach { historyEndpoint ->
                val historyButton = Button(this).apply {
                    text = historyEndpoint
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    setOnClickListener {
                        endpointInput.setText(historyEndpoint)
                        endpointInput.setSelection(endpointInput.text.length)
                        validationMessage.visibility = View.GONE
                    }
                }
                val historyParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                )
                historyParams.bottomMargin = dp(8)
                form.addView(historyButton, historyParams)
            }
        }

        val actionRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, dp(24), 0, 0)
        }
        val connectButton = Button(this).apply {
            text = getString(R.string.connect)
            setOnClickListener {
                connectToEndpoint(endpointInput.text?.toString().orEmpty(), validationMessage)
            }
        }
        actionRow.addView(connectButton)

        if (endpoint != null) {
            val clearButton = Button(this).apply {
                text = getString(R.string.clear_endpoint)
                setOnClickListener {
                    preferences.clearEndpoint()
                    endpoint = null
                    webView?.stopLoading()
                    showSettingsScreen()
                }
            }
            actionRow.addView(clearButton, 0)
        }

        form.addView(actionRow, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        scrollView.addView(form)
        contentContainer.addView(scrollView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        settingsEndpointInput = endpointInput
        settingsValidationMessage = validationMessage
    }

    private fun connectToEndpoint(rawValue: String, validationMessage: TextView?) {
        val normalizedEndpoint = UrlPolicy.normalizeEndpoint(rawValue)
        if (normalizedEndpoint == null) {
            validationMessage?.text = getString(R.string.invalid_endpoint)
            validationMessage?.visibility = View.VISIBLE
            return
        }

        validationMessage?.visibility = View.GONE
        endpoint = Uri.parse(normalizedEndpoint)
        preferences.saveEndpoint(normalizedEndpoint)
        showWebScreen(forceReload = true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWebScreen(restoredState: Bundle? = null, forceReload: Boolean = false) {
        val currentEndpoint = endpoint ?: run {
            showSettingsScreen()
            return
        }

        detachWebView()
        contentContainer.removeAllViews()
        settingsButton.isEnabled = true
        settingsEndpointInput = null
        settingsValidationMessage = null

        val screen = FrameLayout(this)
        contentContainer.addView(screen, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        val currentWebView = getOrCreateWebView(currentEndpoint)
        screen.addView(currentWebView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        progressBar = ProgressBar(this).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        val progressParams = FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER)
        screen.addView(progressBar, progressParams)

        errorPanel = createErrorPanel {
            showWebScreen(forceReload = true)
        }
        screen.addView(errorPanel, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        errorPanel?.visibility = View.GONE

        currentWebView.visibility = View.VISIBLE
        if (restoredState != null) {
            currentWebView.restoreState(restoredState)
        } else if (forceReload || currentWebView.url.isNullOrBlank() || currentWebView.url == "about:blank") {
            currentWebView.loadUrl(currentEndpoint.toString())
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun getOrCreateWebView(allowedEndpoint: Uri): WebView {
        webView?.let { existingWebView ->
            if (webViewEndpoint?.toString() == allowedEndpoint.toString()) {
                return existingWebView
            }
            existingWebView.stopLoading()
            existingWebView.destroy()
            webView = null
            webViewEndpoint = null
        }

        val createdWebView = WebView(this)
        createdWebView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // WebSocketで文ごとに届くTTSを、ユーザー操作後の非同期処理から連続再生する。
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(createdWebView, false)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val navigationPolicy = WebViewNavigationPolicy(allowedEndpoint.toString())
        createdWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) {
                    return false
                }

                return when (navigationPolicy.decide(request.url.toString(), true)) {
                    NavigationDecision.LOAD_IN_WEBVIEW -> false
                    NavigationDecision.OPEN_EXTERNAL -> {
                        openExternalUrl(request.url)
                        true
                    }
                    NavigationDecision.BLOCK -> true
                }
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar?.visibility = View.VISIBLE
                errorPanel?.visibility = View.GONE
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                progressBar?.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    showConnectionError()
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: android.webkit.WebResourceResponse) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                    showConnectionError()
                }
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
                // 証明書エラーを無視して通信を継続しない。
                handler.cancel()
                showSslError()
            }
        }

        createdWebView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                uploadCallback?.onReceiveValue(null)
                uploadCallback = filePathCallback
                return try {
                    filePickerLauncher.launch("image/*")
                    true
                } catch (_: ActivityNotFoundException) {
                    uploadCallback?.onReceiveValue(null)
                    uploadCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                // マイクやカメラのネイティブ権限は MVP では許可しない。
                request.deny()
            }
        }

        webView = createdWebView
        webViewEndpoint = allowedEndpoint
        return createdWebView
    }

    private fun createErrorPanel(onRetry: () -> Unit): View {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(24), dp(32), dp(24))
            setBackgroundColor(ContextCompat.getColor(context, R.color.tonarice_background))
        }

        val title = TextView(this).apply {
            text = getString(R.string.connection_error_title)
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(ContextCompat.getColor(context, R.color.tonarice_on_surface))
        }
        panel.addView(title, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val message = TextView(this).apply {
            text = getString(R.string.connection_error_message)
            gravity = Gravity.CENTER
            setTextColor(ContextCompat.getColor(context, R.color.tonarice_on_surface))
            setPadding(0, dp(12), 0, dp(12))
        }
        panel.addView(message, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val retryButton = Button(this).apply {
            text = getString(R.string.retry)
            setOnClickListener { onRetry() }
        }
        panel.addView(retryButton, LinearLayout.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        return panel
    }

    private fun showConnectionError() {
        progressBar?.visibility = View.GONE
        errorPanel?.visibility = View.VISIBLE
    }

    private fun showSslError() {
        progressBar?.visibility = View.GONE
        errorPanel?.visibility = View.VISIBLE
        Toast.makeText(this, getString(R.string.ssl_error), Toast.LENGTH_LONG).show()
    }

    private fun openExternalUrl(uri: Uri) {
        if (!UrlPolicy.isHttpUri(uri.toString())) {
            return
        }
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, getString(R.string.external_link_error), Toast.LENGTH_SHORT).show()
        }
    }

    private fun detachWebView() {
        webView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.visibility = View.GONE
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val KEY_ENDPOINT = "endpoint"
        const val KEY_WEB_VIEW_STATE = "web_view_state"
    }
}
