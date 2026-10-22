package dev.truapi.playground

import android.content.Context
import android.net.Uri
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Serves the product's own files, like `DotNsWebViewClient` in the Nova Android host (polkadot-android-community).
 *
 * The real host downloads the product archive from DotNS and serves the unpacked files for
 * `https://<product>.dot/...`. Here the files are the synthetic product in `web/`, copied from
 * the APK assets to a local folder. There is no DotNS lookup and no download.
 *
 * Same lookup order and response shape as the real client: exact file, root `index.html`,
 * `<path>/index.html` for an extensionless path, `index.html` for a main-frame route,
 * else a 404. The response has no extra headers (no CORS, no cache headers).
 */
class ProductFileServer(context: Context, private val productDomain: String) {
    private val root: File = File(context.filesDir, "products/$productDomain").also { copyAssets(context, it) }

    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val url: Uri = request.url
        if (url.scheme != "https" || url.host != productDomain) return null

        val requestPath = (url.path ?: "/").removePrefix("/")
        val file = resolveFile(requestPath) ?: spaFallback(request) ?: return notFound()
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension) ?: "application/octet-stream"
        Log.i(HostWebViewClient.TAG, "PRODUCT $url -> ${file.name} $mime")
        return WebResourceResponse(mime, "UTF-8", file.inputStream())
    }

    private fun resolveFile(requestPath: String): File? {
        if (requestPath.isEmpty()) File(root, "index.html").takeIf { it.isFile }?.let { return it }
        File(root, requestPath).takeIf { it.isFile }?.let { return it }
        if (!requestPath.contains('.')) File(root, "$requestPath/index.html").takeIf { it.isFile }?.let { return it }
        return null
    }

    private fun spaFallback(request: WebResourceRequest): File? =
        if (request.isForMainFrame) File(root, "index.html").takeIf { it.isFile } else null

    private fun notFound() = WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream("Not Found".toByteArray()))
        .apply { setStatusCodeAndReasonPhrase(404, "Not Found") }

    private companion object {
        /** Stand-in for "archive downloaded and unpacked": copy the bundled product files once per launch. */
        fun copyAssets(context: Context, dir: File) {
            dir.mkdirs()
            for (name in context.assets.list("").orEmpty()) {
                val input = runCatching { context.assets.open(name) }.getOrNull() ?: continue
                input.use { src -> File(dir, name).outputStream().use { src.copyTo(it) } }
            }
        }
    }
}
