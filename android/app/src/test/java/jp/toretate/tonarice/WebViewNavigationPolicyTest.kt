package jp.toretate.tonarice

import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewNavigationPolicyTest {
    private val policy = WebViewNavigationPolicy("https://tonarice.example/")

    @Test
    fun `decide_同一オリジンの主フレームはWebViewで読み込む`() {
        assertEquals(
            NavigationDecision.LOAD_IN_WEBVIEW,
            policy.decide("https://tonarice.example/#chat", isMainFrame = true),
        )
    }

    @Test
    fun `decide_外部HTTPSはブラウザへ渡す`() {
        assertEquals(
            NavigationDecision.OPEN_EXTERNAL,
            policy.decide("https://accounts.example/login", isMainFrame = true),
        )
    }

    @Test
    fun `decide_カスタムスキームは拒否する`() {
        assertEquals(
            NavigationDecision.BLOCK,
            policy.decide("intent://settings", isMainFrame = true),
        )
    }

    @Test
    fun `decide_サブリソースはWebViewの通常処理に任せる`() {
        assertEquals(
            NavigationDecision.LOAD_IN_WEBVIEW,
            policy.decide("https://cdn.example/image.png", isMainFrame = false),
        )
    }
}
