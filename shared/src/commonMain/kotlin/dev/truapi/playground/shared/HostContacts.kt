package dev.truapi.playground.shared

data class Rgb(val r: Int, val g: Int, val b: Int) {
    val css: String get() = "rgb($r,$g,$b)"
}

/** Synthetic host-owned contact. Product pages never see [id] or [name]. */
data class Contact(val id: String, val name: String, val color: Rgb)

/**
 * Host-owned contact store with product-scoped aliases.
 *
 * Each product gets its own alias for the same contact, so two products cannot
 * match aliases. [resolve] takes the product from the caller (the host binds it to
 * the WebView), never from the request URL.
 */
object HostContacts {
    /**
     * The product the demo WebView is bound to. Like Nova, the product ID is its DotNS
     * domain, and the page origin is built from it (`https://demo-product.dot`,
     * `polkadot://demo-product.dot`). Synthetic: no such domain is resolved.
     */
    const val DEMO_PRODUCT = "demo-product.dot"
    const val OTHER_PRODUCT = "other-product.dot"

    val contacts: List<Contact> = listOf(
        Contact("contact-1", "Alice Example", Rgb(10, 120, 200)),
        Contact("contact-2", "Bob Sample", Rgb(200, 90, 40)),
    )

    /** (productId, alias) -> contact id. A lookup table is enough; aliases need not be derived. */
    private val aliases: Map<Pair<String, String>, String> = mapOf(
        (DEMO_PRODUCT to "a7f3k2") to "contact-1",
        (DEMO_PRODUCT to "m4q8z1") to "contact-2",
        (OTHER_PRODUCT to "q2k9w5") to "contact-1",
        (OTHER_PRODUCT to "t6n1c8") to "contact-2",
    )

    /** Shown for an alias that does not resolve in this product: same size and status as a real one. */
    const val PLACEHOLDER_NAME = "Unknown contact"
    val PLACEHOLDER_COLOR = Rgb(160, 160, 170)

    fun resolve(productId: String, alias: String): Contact? =
        aliases[productId to alias]?.let { id -> contacts.first { it.id == id } }
}
