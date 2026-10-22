package dev.truapi.playground.shared

/** Platform-neutral view of one request the WebView asks the host to serve. */
data class HostRequest(
    val scheme: String,
    val host: String,
    val path: String,
    val query: Map<String, String> = emptyMap(),
)

sealed interface HostRoute {
    /** Serve this body. */
    class Body(
        val status: Int,
        val reason: String,
        val mimeType: String,
        val bytes: ByteArray,
        val headers: Map<String, String>,
    ) : HostRoute {
        val text: String get() = bytes.decodeToString()
    }

    /** Serve a bundled web file (from ../web). */
    data class Asset(val name: String) : HostRoute

    /** Not ours. Let the WebView load it normally. */
    data object PassThrough : HostRoute
}

/** Test instrumentation: records requests made by the probe SVG. Must be thread-safe. */
interface BeaconLog {
    fun record(id: String, kind: String)
    fun hits(id: String): List<String>
}

/**
 * URL map shared by all platforms. One instance serves one WebView, bound to one product.
 *
 * Host data, on `truapi-host://<path>` and (Android only) `https://host.test/<path>`:
 * - `contacts/<alias>/name`: the contact name as a fixed-size SVG.
 * - `contacts/<alias>/avatar`: the contact avatar as a fixed-size PNG.
 *   An alias that does not resolve in [productId] gives a placeholder with the same size and status.
 * - `contacts/<alias>/frame`: HTML page with the name, for iframe probes.
 * - `contacts/<alias>/leaky-name`, `.../leaky-avatar`: bad host, test controls only.
 *   Size follows the name; an alias that does not resolve gives 404.
 * - `probe/<id>`: SVG that tries script, `@import`, and `<image>` beacons.
 * - `beacon/<id>/<kind>` and `beacon-log/<id>`: beacon record and read-back.
 *
 * Diagnostic product page files: `https://product.test/...`, `truapi-host://app/...`, and
 * `truapi-host://<host>/app/...` (the last two are negative cases). The Nova-like product page
 * (`https://demo-product.dot/`, `polkadot://demo-product.dot/`) is not served here: each
 * platform has its own product file handler, like the real hosts.
 *
 * The product comes only from [productId]. Nothing in the request can change it.
 * `?cors=1` adds `Access-Control-Allow-Origin: *`. Only the tests use it, as a
 * control. A real host must never send that header on private data.
 */
class HostRoutes(
    private val productId: String,
    private val beacons: BeaconLog,
    /** Where the probe SVG sends beacons. iOS uses `truapi-host://beacon`, as it cannot serve https. */
    private val beaconBase: String = "https://$VIRTUAL_HOST/beacon",
) {

    fun route(req: HostRequest): HostRoute {
        val path = req.path.removePrefix("/")
        val cors = req.query["cors"] == "1"
        // Test instrumentation: lets the page check if a request reached the host at all.
        req.query["trace"]?.let { beacons.record(it, "reached") }
        return when {
            req.scheme == "https" && req.host == PRODUCT_HOST -> productFile(path)
            req.scheme == SCHEME && req.host == APP_HOST -> productFile(path)
            req.scheme == SCHEME && path.startsWith("$APP_HOST/") -> productFile(path.removePrefix("$APP_HOST/"))
            req.scheme == SCHEME -> hostData(req.host, path, cors)
            req.scheme == "https" && req.host == VIRTUAL_HOST -> {
                val parts = path.split("/", limit = 2)
                if (parts.size == 2) hostData(parts[0], parts[1], cors) else notFound()
            }
            else -> HostRoute.PassThrough
        }
    }

    private fun productFile(path: String): HostRoute =
        HostRoute.Asset(path.ifEmpty { "index.html" })

    private fun hostData(kind: String, rest: String, cors: Boolean): HostRoute = when (kind) {
        "contacts" -> {
            val parts = rest.split("/")
            if (parts.size == 2) contact(parts[0], parts[1], cors) else notFound()
        }
        "probe" -> ok(SVG, AvatarSvg.probe(rest) { "$beaconBase/$rest/$it" }.encodeToByteArray(), cors)
        "beacon" -> {
            val (id, what) = rest.split("/", limit = 2).let { it[0] to it.getOrElse(1) { "?" } }
            beacons.record(id, what)
            ok("text/plain", ByteArray(0), cors = false)
        }
        "beacon-log" -> {
            val json = beacons.hits(rest).joinToString(",", "[", "]") { kind ->
                "\"" + kind.filter { it.isLetterOrDigit() || it == '-' } + "\""
            }
            ok("application/json", json.encodeToByteArray(), cors = true)
        }
        else -> notFound()
    }

    private fun contact(alias: String, what: String, cors: Boolean): HostRoute {
        val contact = HostContacts.resolve(productId, alias)
        val name = contact?.name ?: HostContacts.PLACEHOLDER_NAME
        val color = contact?.color ?: HostContacts.PLACEHOLDER_COLOR
        return when (what) {
            "name" -> ok(SVG, AvatarSvg.render(name, color).encodeToByteArray(), cors)
            "avatar" -> ok(PNG, AvatarPng.render(contact), cors)
            // The same contact as host-owned HTML: name as DOM text, avatar as a relative image.
            "frame" -> ok(
                "text/html",
                ("<!doctype html><meta charset=utf-8>" +
                    "<body style=\"margin:0;font:16px sans-serif;background:#e8f1fb;padding:6px;" +
                    "display:flex;align-items:center;gap:8px\">" +
                    "<img src=\"avatar\" alt=\"\" width=\"32\" height=\"32\">" +
                    "<span>Host frame: ${AvatarSvg.escapeXml(name)}</span></body>").encodeToByteArray(),
                cors,
            )
            "leaky-name" -> contact?.let { ok(SVG, AvatarSvg.renderLeaky(it.name, it.color).encodeToByteArray(), cors) }
                ?: notFound()
            "leaky-avatar" -> contact?.let { ok(PNG, AvatarPng.renderLeaky(it), cors) } ?: notFound()
            else -> notFound()
        }
    }

    private fun ok(mime: String, body: ByteArray, cors: Boolean): HostRoute.Body {
        val headers = buildMap {
            put("Cache-Control", "no-store")
            put("X-Content-Type-Options", "nosniff")
            if (cors) put("Access-Control-Allow-Origin", "*")
        }
        return HostRoute.Body(200, "OK", mime, body, headers)
    }

    private fun notFound() =
        HostRoute.Body(404, "Not Found", "text/plain", ByteArray(0), mapOf("Cache-Control" to "no-store"))

    companion object {
        const val SCHEME = "truapi-host"
        /** Product scheme of the Nova iOS host (polkadot-ios-community, `ProductScriptSchemeHandler.scheme`). */
        const val POLKADOT_SCHEME = "polkadot"
        const val APP_HOST = "app"
        const val PRODUCT_HOST = "product.test"
        const val VIRTUAL_HOST = "host.test"
        private const val SVG = "image/svg+xml"
        private const val PNG = "image/png"

        fun mimeTypeFor(name: String): String = when (name.substringAfterLast('.', "")) {
            "html" -> "text/html"
            "js" -> "text/javascript"
            "css" -> "text/css"
            "svg" -> SVG
            "png" -> PNG
            else -> "application/octet-stream"
        }
    }
}
