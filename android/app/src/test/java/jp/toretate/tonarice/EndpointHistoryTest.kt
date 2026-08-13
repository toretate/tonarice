package jp.toretate.tonarice

import org.junit.Assert.assertEquals
import org.junit.Test

class EndpointHistoryTest {
    private val history = EndpointHistory(maxEntries = 5)

    @Test
    fun `sanitize_重複と不正URLを除外して上限件数に切り詰める`() {
        assertEquals(
            listOf(
                "https://five.example/",
                "https://four.example/",
                "https://three.example/",
                "https://two.example/",
                "https://one.example/",
            ),
            history.sanitize(
                listOf(
                    "https://five.example/",
                    "javascript:alert(1)",
                    "https://four.example/",
                    "https://three.example/",
                    "https://two.example/",
                    "https://one.example/",
                    "https://zero.example/",
                    "https://five.example/",
                ),
            ),
        )
    }

    @Test
    fun `add_新しいURLを先頭へ移動して履歴を上限内に保つ`() {
        assertEquals(
            listOf(
                "https://three.example/",
                "https://one.example/",
                "https://two.example/",
            ),
            EndpointHistory(maxEntries = 3).add(
                listOf("https://one.example/", "https://two.example/", "https://three.example/"),
                "https://three.example/",
            ),
        )
    }
}
