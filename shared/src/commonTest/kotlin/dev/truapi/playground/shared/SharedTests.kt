package dev.truapi.playground.shared

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ListBeaconLog : BeaconLog {
    val log = mutableListOf<Pair<String, String>>()
    override fun record(id: String, kind: String) { log += id to kind }
    override fun hits(id: String) = log.filter { it.first == id }.map { it.second }
}

class HostRoutesTest {
    private val beacons = ListBeaconLog()
    private val routes = HostRoutes(HostContacts.DEMO_PRODUCT, beacons)

    private val alice = "a7f3k2"       // contact-1 in demo-product.dot
    private val bob = "m4q8z1"         // contact-2 in demo-product.dot
    private val aliceInB = "q2k9w5"    // contact-1 in other-product.dot

    private fun body(scheme: String, host: String, path: String, query: Map<String, String> = emptyMap()) =
        assertIs<HostRoute.Body>(routes.route(HostRequest(scheme, host, path, query)))

    private fun contact(alias: String, what: String, query: Map<String, String> = emptyMap()) =
        body("truapi-host", "contacts", "/$alias/$what", query)

    private val size = Regex("""width="(\d+)" height="(\d+)"""")

    @Test
    fun nameIsSvgWithName() {
        val r = contact(alice, "name")
        assertEquals(200, r.status)
        assertEquals("image/svg+xml", r.mimeType)
        assertTrue("Alice Example" in r.text)
        assertFalse("Access-Control-Allow-Origin" in r.headers)
    }

    @Test
    fun avatarIsFixedSizePng() {
        val r = contact(alice, "avatar")
        assertEquals(200, r.status)
        assertEquals("image/png", r.mimeType)
        assertEquals(listOf(137, 80, 78, 71), r.bytes.take(4).map { it.toInt() and 0xff })
        for (a in listOf(bob, "missing", aliceInB)) {
            assertEquals(pngSize(r.bytes), pngSize(contact(a, "avatar").bytes))
        }
        assertEquals(64 to 64, pngSize(r.bytes))
    }

    @Test
    fun virtualHttpsServesSameData() {
        assertEquals(contact(alice, "name").text, body("https", "host.test", "/contacts/$alice/name").text)
    }

    @Test
    fun corsHeaderOnlyWhenAsked() {
        assertEquals("*", contact(alice, "name", mapOf("cors" to "1")).headers["Access-Control-Allow-Origin"])
    }

    @Test
    fun aliasFromOtherProductGetsPlaceholder() {
        val name = contact(aliceInB, "name")
        assertFalse("Alice Example" in name.text)
        assertTrue(HostContacts.PLACEHOLDER_NAME in name.text)
        assertTrue(contact(aliceInB, "avatar").bytes.contentEquals(contact("missing", "avatar").bytes))
    }

    @Test
    fun productInUrlIsIgnored() {
        val r = contact(aliceInB, "name", mapOf("product" to HostContacts.OTHER_PRODUCT))
        assertTrue(HostContacts.PLACEHOLDER_NAME in r.text)
        val other = HostRoutes(HostContacts.OTHER_PRODUCT, beacons)
        val inB = assertIs<HostRoute.Body>(other.route(HostRequest("truapi-host", "contacts", "/$aliceInB/name")))
        assertTrue("Alice Example" in inB.text)
    }

    @Test
    fun unknownAliasLooksLikeKnownAlias() {
        for (what in listOf("name", "avatar")) {
            val known = contact(alice, what)
            val unknown = contact("missing", what)
            assertEquals(200, unknown.status)
            assertEquals(known.headers, unknown.headers)
            assertEquals(known.mimeType, unknown.mimeType)
        }
        assertEquals(size.find(contact(alice, "name").text)?.value, size.find(contact("missing", "name").text)?.value)
    }

    @Test
    fun leakyControlsShowSizeAndExistence() {
        assertTrue(size.find(contact(alice, "leaky-name").text)?.value != size.find(contact(bob, "leaky-name").text)?.value)
        assertTrue(pngSize(contact(alice, "leaky-avatar").bytes) != pngSize(contact(bob, "leaky-avatar").bytes))
        assertEquals(404, contact("missing", "leaky-name").status)
        assertEquals(404, contact(aliceInB, "leaky-avatar").status)
    }

    @Test
    fun probeSvgBeaconsAreRecordedAndReadBack() {
        val svg = body("truapi-host", "probe", "/p1").text
        assertTrue("https://host.test/beacon/p1/script" in svg)
        assertTrue("https://host.test/beacon/p1/css-import" in svg)
        body("https", "host.test", "/beacon/p1/script")
        body("https", "host.test", "/beacon/p2/script")
        val log = body("https", "host.test", "/beacon-log/p1")
        assertEquals("[\"script\"]", log.text)
        assertEquals("*", log.headers["Access-Control-Allow-Origin"])
    }

    @Test
    fun beaconBaseIsConfigurable() {
        val ios = HostRoutes(HostContacts.DEMO_PRODUCT, beacons, beaconBase = "truapi-host://beacon")
        val svg = assertIs<HostRoute.Body>(ios.route(HostRequest("truapi-host", "probe", "/p3"))).text
        assertTrue("truapi-host://beacon/p3/script" in svg)
        ios.route(HostRequest("truapi-host", "beacon", "/p3/script"))
        assertEquals(listOf("script"), beacons.hits("p3"))
    }

    @Test
    fun productFilesAreAssets() {
        fun route(scheme: String, host: String, path: String) = routes.route(HostRequest(scheme, host, path))
        assertEquals(HostRoute.Asset("index.html"), route("https", "product.test", "/"))
        assertEquals(HostRoute.Asset("probe.js"), route("truapi-host", "app", "/probe.js"))
        // The Nova-like product origins are served by the platform product handlers, not here.
        assertEquals(HostRoute.PassThrough, route("https", HostContacts.DEMO_PRODUCT, "/"))
        assertEquals(HostRoute.PassThrough, route("polkadot", HostContacts.DEMO_PRODUCT, "/index.html"))
        assertEquals(HostRoute.Asset("index.html"), route("truapi-host", "contacts", "/app/index.html"))
    }

    @Test
    fun otherUrlsPassThrough() {
        assertEquals(HostRoute.PassThrough, routes.route(HostRequest("https", "example.com", "/")))
    }

    private fun pngSize(png: ByteArray): Pair<Int, Int> {
        fun int(at: Int) = (0 until 4).fold(0) { acc, i -> (acc shl 8) or (png[at + i].toInt() and 0xff) }
        return int(16) to int(20)
    }
}

class AvatarSvgTest {
    private val fill = Rgb(1, 2, 3)

    @Test
    fun escapesMarkup() {
        val svg = AvatarSvg.render("<b>&\"'", fill)
        assertTrue("&lt;b&gt;&amp;&quot;&apos;" in svg)
        assertFalse("<b>" in svg)
    }

    @Test
    fun sizeDoesNotDependOnName() {
        val short = AvatarSvg.render("A", fill)
        val long = AvatarSvg.render("A much longer synthetic name", fill)
        val size = Regex("""width="(\d+)" height="(\d+)"""")
        assertEquals(size.find(short)?.value, size.find(long)?.value)
    }
}

class PngTest {
    @Test
    fun encodesValidChunks() {
        val png = Png.encode(2, 1, byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8))
        assertEquals(listOf(137, 80, 78, 71, 13, 10, 26, 10), png.take(8).map { it.toInt() and 0xff })
        assertEquals("IHDR", png.copyOfRange(12, 16).decodeToString())
        assertEquals("IEND", png.copyOfRange(png.size - 8, png.size - 4).decodeToString())
        // IEND CRC is fixed: AE 42 60 82.
        assertEquals(listOf(0xae, 0x42, 0x60, 0x82), png.takeLast(4).map { it.toInt() and 0xff })
    }
}

class VerdictsTest {
    private fun r(source: String, probe: String, want: Want, outcome: String) =
        ProbeResult(source, probe, want, outcome, "")

    private val host = Scenarios.HTTPS.hostSources
    private val own = Verdicts.OWN_ORIGIN_SOURCE

    private fun safeRun() = listOf(
        r(host[0], "<img> display", Want.SHOW, "shown"),
        r(host[0], "canvas getImageData", Want.BLOCK, "blocked"),
        r(host[0], "control: ACAO * canvas getImageData", Want.READ, "READ"),
        r(host[1], "<img> display", Want.SHOW, "shown"),
        r(host[1], "XHR GET", Want.BLOCK, "blocked"),
        r(own, "canvas getImageData", Want.READ, "READ"),
    )

    @Test
    fun safeScenarioPassesWithoutLeaks() {
        assertTrue(Verdicts.evaluate(Scenarios.HTTPS, safeRun()).passed)
    }

    @Test
    fun safeScenarioFailsOnLeak() {
        val run = safeRun() + r(host[0], "XHR GET", Want.BLOCK, "READ")
        val v = Verdicts.evaluate(Scenarios.HTTPS, run)
        assertFalse(v.passed)
        assertEquals(1, v.leaks.size)
    }

    @Test
    fun leakScenarioFailsWithoutLeak() {
        assertFalse(Verdicts.evaluate(Scenarios.CUSTOM, safeRun()).passed)
    }

    @Test
    fun brokenControlFails() {
        val run = safeRun().map { if (it.want == Want.READ && it.source != own) it.copy(outcome = "blocked") else it }
        assertFalse(Verdicts.evaluate(Scenarios.HTTPS, run).passed)
    }

    @Test
    fun strictFileIgnoresOwnOriginControl() {
        val run = safeRun().map { if (it.source == own) it.copy(outcome = "blocked") else it }
        assertTrue(Verdicts.evaluate(Scenarios.FILE_STRICT, run).passed)
        assertFalse(Verdicts.evaluate(Scenarios.HTTPS, run).passed)
    }

    @Test
    fun iosNeedsOnlyTheSchemeSource() {
        val run = safeRun().filterNot { it.source == host[1] }
        assertTrue(Verdicts.evaluate(Scenarios.IOS_NOVA, run).passed)
    }

    @Test
    fun unsupportedProbesAreNotRequired() {
        val run = safeRun() + listOf(
            r(host[0], Scenarios.SVG_FRAME_CONTROL, Want.READ, "blocked"),
            r(host[0], Scenarios.FRAME_LOAD, Want.SHOW, "not shown"),
            r(host[0], "iframe DOM read", Want.BLOCK, "n/a"),
        )
        val ios = Verdicts.evaluate(Scenarios.IOS_HTTPS, run)
        assertTrue(ios.passed)
        assertEquals(1, ios.notRun.size)
        // Where iframes must load, a frame that does not load fails the run.
        assertFalse(Verdicts.evaluate(Scenarios.IOS_CUSTOM, run).passed)
    }

    @Test
    fun mainScenariosMatchRealHostOrigins() {
        assertEquals("https://demo-product.dot/", Scenarios.NOVA.pageUrl)
        assertEquals("polkadot://demo-product.dot/index.html", Scenarios.IOS_NOVA.pageUrl)
        assertEquals(listOf(Scenarios.NOVA), Scenarios.android.filter { it.main })
        assertEquals(listOf(Scenarios.IOS_NOVA), Scenarios.ios.filter { it.main })
        assertEquals(Scenarios.NOVA, Scenarios.android(null))
        assertEquals(Scenarios.IOS_NOVA, Scenarios.ios(null))
    }

    @Test
    fun scenarioIdsAreUnique() {
        val ids = (Scenarios.android + Scenarios.ios).map { it.id }
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun missingSourceFails() {
        val run = safeRun().filterNot { it.source == host[1] }
        assertFalse(Verdicts.evaluate(Scenarios.HTTPS, run).passed)
    }
}
