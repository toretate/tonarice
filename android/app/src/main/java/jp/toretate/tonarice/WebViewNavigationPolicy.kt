package jp.toretate.tonarice

enum class NavigationDecision {
    /** 設定した tonarice オリジン内の URL を WebView で読み込む。 */
    LOAD_IN_WEBVIEW,

    /** HTTP(S) の外部 URL を端末のブラウザへ渡す。 */
    OPEN_EXTERNAL,

    /** カスタムスキームや不正な URL を拒否する。 */
    BLOCK,
}

/**
 * WebView の主フレーム遷移を安全な方針へ変換する。
 */
class WebViewNavigationPolicy(private val allowedEndpoint: String) {
    fun decide(uri: String?, isMainFrame: Boolean): NavigationDecision {
        // 外部画像や音声などのサブリソースは WebView の通常処理に任せる。
        if (!isMainFrame) {
            return NavigationDecision.LOAD_IN_WEBVIEW
        }
        if (uri == null || !UrlPolicy.isHttpUri(uri)) {
            return NavigationDecision.BLOCK
        }
        return if (UrlPolicy.isSameOrigin(allowedEndpoint, uri)) {
            NavigationDecision.LOAD_IN_WEBVIEW
        } else {
            NavigationDecision.OPEN_EXTERNAL
        }
    }
}
