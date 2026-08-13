package jp.toretate.tonarice

import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

/**
 * WebView が読み込む URL と許可オリジンを検証する。
 */
object UrlPolicy {
    /**
     * 接続先として利用できる URL を正規化する。
     */
    fun normalizeEndpoint(rawValue: String): String? {
        val value = rawValue.trim()
        if (value.isEmpty() || value.any { it.isWhitespace() || it.isISOControl() }) {
            return null
        }

        val uri = parseHttpUri(value) ?: return null
        if (uri.userInfo != null || uri.host.isNullOrBlank()) {
            return null
        }
        if (uri.port !in -1..65535) {
            return null
        }

        return uri.toString()
    }

    /**
     * WebView の主フレームで扱える HTTP(S) URL か判定する。
     */
    fun isHttpUri(value: String?): Boolean {
        return value != null && parseHttpUri(value) != null
    }

    /**
     * 2 つの URL が同一オリジンか判定する。
     */
    fun isSameOrigin(allowedEndpoint: String, candidate: String): Boolean {
        val allowedUri = parseHttpUri(allowedEndpoint)
        val candidateUri = parseHttpUri(candidate)
        if (allowedUri == null || candidateUri == null) {
            return false
        }

        val allowedHost = allowedUri.host?.lowercase(Locale.ROOT)
        val candidateHost = candidateUri.host?.lowercase(Locale.ROOT)
        if (allowedHost.isNullOrBlank() || candidateHost.isNullOrBlank()) {
            return false
        }

        return allowedUri.scheme.equals(candidateUri.scheme, ignoreCase = true)
            && allowedHost == candidateHost
            && effectivePort(allowedUri) == effectivePort(candidateUri)
    }

    private fun parseHttpUri(value: String): URI? {
        val uri = try {
            URI(value)
        } catch (_: URISyntaxException) {
            return null
        }
        val scheme = uri.scheme?.lowercase(Locale.ROOT)
        if (scheme != "http" && scheme != "https") {
            return null
        }
        if (uri.host.isNullOrBlank() || uri.userInfo != null) {
            return null
        }
        if (uri.port !in -1..65535) {
            return null
        }
        return uri
    }

    private fun effectivePort(uri: URI): Int {
        if (uri.port != -1) {
            return uri.port
        }
        return if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
    }
}
