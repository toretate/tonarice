package jp.toretate.tonarice

/**
 * 接続先 URL の履歴を新しい順に整理する。
 */
class EndpointHistory(private val maxEntries: Int) {
    init {
        require(maxEntries > 0) { "接続先履歴の上限は1以上で指定してください。" }
    }

    /**
     * 保存済み履歴から不正値と重複を除き、上限件数へ切り詰める。
     */
    fun sanitize(history: List<String>): List<String> {
        return history
            .mapNotNull(UrlPolicy::normalizeEndpoint)
            .distinct()
            .take(maxEntries)
    }

    /**
     * 接続先を履歴の先頭へ追加し、同じ URL を一件にまとめる。
     */
    fun add(history: List<String>, endpoint: String): List<String> {
        val normalizedEndpoint = UrlPolicy.normalizeEndpoint(endpoint) ?: return sanitize(history)
        return sanitize(listOf(normalizedEndpoint) + history)
    }
}
