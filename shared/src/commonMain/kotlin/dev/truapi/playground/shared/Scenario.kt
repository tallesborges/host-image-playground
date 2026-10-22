package dev.truapi.playground.shared

enum class Expectation { SAFE, LEAKS }

/** Where the product page comes from. Each platform loads it its own way. */
enum class PageKind {
    /**
     * `https://demo-product.dot/`: like the Nova Android host (polkadot-android-community). The WebView loads the
     * product domain with `loadUrl`, and `shouldInterceptRequest` serves the product files.
     */
    PRODUCT_DOT_HTTPS,

    /**
     * `polkadot://demo-product.dot/index.html`: like the Nova iOS host (polkadot-ios-community). The web view loads
     * a `URLRequest`, and a `WKURLSchemeHandler` for `polkadot` serves the product files.
     */
    PRODUCT_POLKADOT,

    /** `https://product.test/index.html`. Android intercepts it; iOS loads HTML with that base URL. */
    PRODUCT_HTTPS,

    /** `truapi-host://app/index.html`: product page on the host scheme. */
    HOST_SCHEME,

    /** `truapi-host://contacts/app/index.html`: product page on the same scheme and host as the contact images. */
    HOST_SAME_HOST,

    /** A bundled `file://` page. The URL is platform-specific. */
    FILE,
}

/**
 * One way to load the product page, and what the run must show.
 *
 * @property main true for the scenario that matches how the real host loads products.
 * @property hostSources probe.js source labels that must report results.
 * @property ownOriginReadable false when the page cannot read its own image, so that control is skipped.
 * @property fileUrlAccess Android only: turns on both "from file URLs" WebView flags.
 * @property schemeFetchable true when fetch() can reach `truapi-host://` at all (then the
 *   `Access-Control-Allow-Origin` fetch is a control that must read).
 * @property unsupportedProbes probes that cannot run in this scenario because the engine refuses
 *   the request. Their "show" and "read" checks are not required. The reason is in [Scenarios].
 */
data class Scenario(
    val id: String,
    val label: String,
    val page: PageKind,
    val expectation: Expectation,
    val hostSources: List<String>,
    val main: Boolean = false,
    val ownOriginReadable: Boolean = true,
    val fileUrlAccess: Boolean = false,
    val schemeFetchable: Boolean = false,
    val unsupportedProbes: Set<String> = emptySet(),
) {
    val fileAccess: Boolean get() = page == PageKind.FILE

    /** Null for [PageKind.FILE]; the platform gives the file URL. */
    val pageUrl: String?
        get() = when (page) {
            PageKind.PRODUCT_DOT_HTTPS -> "https://${HostContacts.DEMO_PRODUCT}/"
            PageKind.PRODUCT_POLKADOT -> "${HostRoutes.POLKADOT_SCHEME}://${HostContacts.DEMO_PRODUCT}/index.html"
            PageKind.PRODUCT_HTTPS -> "https://${HostRoutes.PRODUCT_HOST}/index.html"
            PageKind.HOST_SCHEME -> "${HostRoutes.SCHEME}://${HostRoutes.APP_HOST}/index.html"
            PageKind.HOST_SAME_HOST -> "${HostRoutes.SCHEME}://contacts/${HostRoutes.APP_HOST}/index.html"
            PageKind.FILE -> null
        }
}

object Scenarios {
    /** Labels used by web/probe.js. */
    const val SCHEME_SOURCE = "truapi-host://"
    const val VIRTUAL_HTTPS_SOURCE = "https://host.test (virtual HTTPS)"

    /** Probe names used by web/probe.js for the iframe checks. */
    const val SVG_FRAME_CONTROL = "control: same SVG as iframe document"
    const val FRAME_LOAD = "iframe loads"
    const val FRAME_SANDBOX_LOAD = "iframe sandbox=\"allow-scripts allow-same-origin\" loads"

    private val bothSources = listOf(SCHEME_SOURCE, VIRTUAL_HTTPS_SOURCE)

    // Android: shouldInterceptRequest can serve https, so both host sources are tested.
    val NOVA = Scenario(
        "nova", "Nova-like", PageKind.PRODUCT_DOT_HTTPS, Expectation.SAFE, bothSources, main = true,
    )
    val HTTPS = Scenario("https", "HTTPS test", PageKind.PRODUCT_HTTPS, Expectation.SAFE, bothSources)
    val FILE_STRICT = Scenario(
        "file-strict", "File strict", PageKind.FILE, Expectation.SAFE, bothSources,
        // Each file URL is its own origin, so even the page's own image taints the canvas.
        ownOriginReadable = false,
    )
    val CUSTOM = Scenario("custom", "Scheme page", PageKind.HOST_SCHEME, Expectation.LEAKS, bothSources)
    val FILE_UNIVERSAL = Scenario(
        "file-universal", "File open", PageKind.FILE, Expectation.LEAKS, bothSources, fileUrlAccess = true,
    )

    val android: List<Scenario> = listOf(NOVA, HTTPS, FILE_STRICT, CUSTOM, FILE_UNIVERSAL)

    // iOS: WKURLSchemeHandler cannot handle https, so only the custom scheme is a host source.
    // Measured on iOS 26.4 simulator: a custom-scheme origin keeps its host (`truapi-host://app`),
    // and fetch() reaches the scheme from every page except an https one.
    private val schemeOnly = listOf(SCHEME_SOURCE)

    val IOS_NOVA = Scenario(
        "ios-nova", "Nova-like", PageKind.PRODUCT_POLKADOT, Expectation.SAFE, schemeOnly,
        main = true, schemeFetchable = true,
    )
    val IOS_HTTPS = Scenario(
        "ios-https", "HTML string", PageKind.PRODUCT_HTTPS, Expectation.SAFE, schemeOnly,
        // loadHTMLString: there is no server for the page's own files.
        ownOriginReadable = false,
        // WebKit stops fetch, XHR, and iframe loads from an https page to the custom scheme
        // before the handler sees them. Only images load.
        unsupportedProbes = setOf(SVG_FRAME_CONTROL, FRAME_LOAD, FRAME_SANDBOX_LOAD),
    )
    val IOS_FILE = Scenario(
        "ios-file", "File page", PageKind.FILE, Expectation.SAFE, schemeOnly,
        ownOriginReadable = false, schemeFetchable = true,
    )
    val IOS_CUSTOM = Scenario(
        "ios-custom", "Host scheme", PageKind.HOST_SCHEME, Expectation.SAFE, schemeOnly, schemeFetchable = true,
    )
    val IOS_SAME_HOST = Scenario(
        "ios-same-host", "Same host", PageKind.HOST_SAME_HOST, Expectation.LEAKS, schemeOnly, schemeFetchable = true,
    )

    val ios: List<Scenario> = listOf(IOS_NOVA, IOS_HTTPS, IOS_FILE, IOS_CUSTOM, IOS_SAME_HOST)

    fun android(id: String?): Scenario = android.firstOrNull { it.id == id } ?: NOVA
    fun ios(id: String?): Scenario = ios.firstOrNull { it.id == id } ?: IOS_NOVA
}
