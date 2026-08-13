package jp.toretate.tonarice

import android.content.Context

/**
 * Android 版が最後に利用した Web サーバー URL と接続先履歴を保存する。
 * API キーや認証情報はこのストレージへ保存しない。
 */
class ConnectionPreferences(
    context: Context,
    historyLimit: Int = BuildConfig.ENDPOINT_HISTORY_LIMIT,
) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val endpointHistory = EndpointHistory(historyLimit)

    fun loadEndpoint(): String? {
        return preferences.getString(KEY_ENDPOINT, null)?.let(UrlPolicy::normalizeEndpoint)
    }

    /**
     * 接続先を最後に利用した順で返す。
     */
    fun loadEndpointHistory(): List<String> {
        val currentEndpoint = loadEndpoint()
        val storedHistory = preferences.getString(KEY_ENDPOINT_HISTORY, null)
            ?.split(HISTORY_SEPARATOR)
            .orEmpty()
        return endpointHistory.sanitize(listOfNotNull(currentEndpoint) + storedHistory)
    }

    fun saveEndpoint(endpoint: String) {
        val normalizedEndpoint = UrlPolicy.normalizeEndpoint(endpoint) ?: return
        val history = endpointHistory.add(loadEndpointHistory(), normalizedEndpoint)
        preferences.edit()
            .putString(KEY_ENDPOINT, normalizedEndpoint)
            .putString(KEY_ENDPOINT_HISTORY, history.joinToString(HISTORY_SEPARATOR))
            .apply()
    }

    fun clearEndpoint() {
        preferences.edit().remove(KEY_ENDPOINT).apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "tonarice_connection"
        const val KEY_ENDPOINT = "endpoint"
        const val KEY_ENDPOINT_HISTORY = "endpoint_history"
        const val HISTORY_SEPARATOR = "\n"
    }
}
