package dev.truapi.playground.shared

/**
 * Renders a name as an SVG badge. The safe form has a fixed size, so that
 * naturalWidth/naturalHeight do not reveal the name length.
 */
object AvatarSvg {
    const val WIDTH = 200
    const val HEIGHT = 48

    fun render(text: String, fill: Rgb): String = svg(WIDTH, text, fill)

    /** Bad host, test control only: the width follows the text length. */
    fun renderLeaky(text: String, fill: Rgb): String = svg(text.length * 10 + 20, text, fill)

    private fun svg(width: Int, text: String, fill: Rgb) =
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"$width\" height=\"$HEIGHT\">" +
            "<rect width=\"$width\" height=\"$HEIGHT\" rx=\"8\" fill=\"${fill.css}\"/>" +
            "<text x=\"${width / 2}\" y=\"30\" font-family=\"sans-serif\" font-size=\"18\" " +
            "fill=\"#fff\" text-anchor=\"middle\">${escapeXml(text)}</text></svg>"

    /**
     * Test SVG that tries to run a script and load two external resources.
     * Each attempt calls [beaconUrl]. As an `<img>` it must make no request.
     */
    fun probe(id: String, beaconUrl: (kind: String) -> String): String =
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"40\">" +
            "<style>@import url(\"${escapeXml(beaconUrl("css-import"))}\");</style>" +
            "<rect width=\"120\" height=\"40\" fill=\"#fde68a\"/>" +
            "<image href=\"${escapeXml(beaconUrl("external-image"))}\" width=\"1\" height=\"1\"/>" +
            "<text x=\"6\" y=\"25\" font-family=\"sans-serif\" font-size=\"13\">probe ${escapeXml(id)}</text>" +
            "<script><![CDATA[new Image().src = \"${beaconUrl("script")}\";]]></script></svg>"

    fun escapeXml(s: String): String = buildString {
        for (c in s) {
            when (c) {
                '&' -> append("&amp;")
                '<' -> append("&lt;")
                '>' -> append("&gt;")
                '"' -> append("&quot;")
                '\'' -> append("&apos;")
                else -> append(c)
            }
        }
    }
}
