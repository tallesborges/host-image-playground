package dev.truapi.playground

import android.content.Context
import android.net.Uri
import android.util.Log
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import dev.truapi.playground.shared.BeaconLog
import dev.truapi.playground.shared.HostContacts
import dev.truapi.playground.shared.HostRequest
import dev.truapi.playground.shared.HostRoute
import dev.truapi.playground.shared.HostRoutes
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Android side of the host: maps WebView requests to the shared [HostRoutes].
 * One client per WebView. [productId] is set by the host when it creates the WebView,
 * never taken from a request.
 */
class HostWebViewClient(
    private val context: Context,
    productId: String = HostContacts.DEMO_PRODUCT,
) : WebViewClient() {
    /** Product files for `https://<productId>/`, like the real host. */
    private val products = ProductFileServer(context, productId)

    /** Private host resources (`truapi-host://`, `https://host.test`) and diagnostic pages. */
    private val routes = HostRoutes(productId, Beacons)

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        Log.i(TAG, "REQ ${request.method} $url main=${request.isForMainFrame} origin=${request.requestHeaders["Origin"]}")
        products.intercept(request)?.let { return it }
        return when (val route = routes.route(url.toHostRequest())) {
            is HostRoute.Body -> WebResourceResponse(
                route.mimeType, "utf-8", route.status, route.reason, route.headers,
                ByteArrayInputStream(route.bytes),
            )
            is HostRoute.Asset -> asset(route.name)
            HostRoute.PassThrough -> null
        }
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        Log.i(TAG, "NAV ${request.url} main=${request.isForMainFrame}")
        return false
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        Log.i(TAG, "ERR ${request.url} code=${error.errorCode} desc=${error.description}")
    }

    /** Diagnostic product pages. Same response shape as the product file server: no extra headers. */
    private fun asset(name: String): WebResourceResponse =
        try {
            WebResourceResponse(HostRoutes.mimeTypeFor(name), "UTF-8", context.assets.open(name))
        } catch (e: IOException) {
            WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }

    private fun Uri.toHostRequest() = HostRequest(
        scheme = scheme.orEmpty(),
        host = host.orEmpty(),
        path = path.orEmpty(),
        query = queryParameterNames.associateWith { getQueryParameter(it).orEmpty() },
    )

    /** WebView calls shouldInterceptRequest on several threads. */
    object Beacons : BeaconLog {
        private val log = ConcurrentHashMap<String, CopyOnWriteArrayList<String>>()
        override fun record(id: String, kind: String) {
            Log.i(TAG, "BEACON $id $kind")
            log.getOrPut(id) { CopyOnWriteArrayList() }.add(kind)
        }
        override fun hits(id: String): List<String> = log[id]?.toList().orEmpty()
    }

    companion object {
        const val TAG = "TRUAPI"
    }
}
