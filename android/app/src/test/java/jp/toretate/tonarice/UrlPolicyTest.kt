package jp.toretate.tonarice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlPolicyTest {
    @Test
    fun `normalizeEndpoint_HTTPSと末尾スラッシュを受け付ける`() {
        assertEquals(
            "https://example.example/",
            UrlPolicy.normalizeEndpoint("  https://example.example/  "),
        )
    }

    @Test
    fun `normalizeEndpoint_ユーザー情報と未知スキームを拒否する`() {
        assertNull(UrlPolicy.normalizeEndpoint("https://user:password@example.example"))
        assertNull(UrlPolicy.normalizeEndpoint("javascript:alert(1)"))
        assertNull(UrlPolicy.normalizeEndpoint("file:///data/local/tmp/index.html"))
    }

    @Test
    fun `normalizeEndpoint_ホストなしと不正ポートを拒否する`() {
        assertNull(UrlPolicy.normalizeEndpoint("https:///missing-host"))
        assertNull(UrlPolicy.normalizeEndpoint("https://example.example:70000"))
    }

    @Test
    fun `isSameOrigin_既定ポートと明示ポートを同一として判定する`() {
        val endpoint = "https://EXAMPLE.example/"
        assertTrue(UrlPolicy.isSameOrigin(endpoint, "https://example.example:443/chat"))
        assertFalse(UrlPolicy.isSameOrigin(endpoint, "http://example.example/chat"))
        assertFalse(UrlPolicy.isSameOrigin(endpoint, "https://other.example/chat"))
    }
}
