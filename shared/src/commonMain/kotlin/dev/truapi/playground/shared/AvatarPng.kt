package dev.truapi.playground.shared

/**
 * Renders a contact avatar as a PNG. It stands in for a real photo: the point is a
 * raster image, not the drawing. The size is fixed for every contact and for the placeholder.
 */
object AvatarPng {
    const val SIZE = 64

    /** [contact] null gives the placeholder silhouette. */
    fun render(contact: Contact?): ByteArray {
        val bg = contact?.color ?: HostContacts.PLACEHOLDER_COLOR
        val px = Canvas(SIZE, SIZE)
        px.circle(SIZE / 2.0, SIZE / 2.0, SIZE / 2.0, bg)
        if (contact == null) {
            val fg = Rgb(220, 220, 226)
            px.circle(32.0, 25.0, 10.0, fg)
            px.circle(32.0, 58.0, 20.0, fg)
            px.clipToCircle()
        } else {
            // 5x5 mirrored pattern from the contact id, in the middle 40x40 area.
            val bits = fnv1a(contact.id)
            for (row in 0 until 5) for (col in 0 until 3) {
                if ((bits shr (row * 3 + col)) and 1u == 1u) {
                    px.rect(12 + col * 8, 12 + row * 8, 8, 8, Rgb(255, 255, 255))
                    px.rect(12 + (4 - col) * 8, 12 + row * 8, 8, 8, Rgb(255, 255, 255))
                }
            }
        }
        return Png.encode(SIZE, SIZE, px.rgba)
    }

    /** Bad host, test control only: the width follows the name length. */
    fun renderLeaky(contact: Contact): ByteArray {
        val width = 40 + contact.name.length * 2
        val px = Canvas(width, SIZE)
        px.rect(0, 0, width, SIZE, contact.color)
        return Png.encode(width, SIZE, px.rgba)
    }

    private fun fnv1a(s: String): UInt {
        var h = 2166136261u
        for (c in s) {
            h = h xor c.code.toUInt()
            h *= 16777619u
        }
        return h
    }

    private class Canvas(val w: Int, val h: Int) {
        val rgba = ByteArray(w * h * 4)

        fun set(x: Int, y: Int, c: Rgb, a: Int = 255) {
            if (x !in 0 until w || y !in 0 until h) return
            val i = (y * w + x) * 4
            rgba[i] = c.r.toByte()
            rgba[i + 1] = c.g.toByte()
            rgba[i + 2] = c.b.toByte()
            rgba[i + 3] = a.toByte()
        }

        fun rect(x0: Int, y0: Int, rw: Int, rh: Int, c: Rgb) {
            for (y in y0 until y0 + rh) for (x in x0 until x0 + rw) set(x, y, c)
        }

        fun circle(cx: Double, cy: Double, r: Double, c: Rgb) {
            for (y in 0 until h) for (x in 0 until w) {
                val dx = x + 0.5 - cx
                val dy = y + 0.5 - cy
                if (dx * dx + dy * dy <= r * r) set(x, y, c)
            }
        }

        fun clipToCircle() {
            val r = w / 2.0
            for (y in 0 until h) for (x in 0 until w) {
                val dx = x + 0.5 - r
                val dy = y + 0.5 - r
                if (dx * dx + dy * dy > r * r) rgba[(y * w + x) * 4 + 3] = 0
            }
        }
    }
}

/** Minimal PNG encoder: 8-bit RGBA, no filter, stored (uncompressed) deflate blocks. */
object Png {
    private val SIGNATURE = byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)

    fun encode(width: Int, height: Int, rgba: ByteArray): ByteArray {
        require(rgba.size == width * height * 4)
        val raw = ByteArray(height * (width * 4 + 1))
        for (y in 0 until height) {
            val row = y * (width * 4 + 1)
            raw[row] = 0
            rgba.copyInto(raw, row + 1, y * width * 4, (y + 1) * width * 4)
        }
        val ihdr = Bytes().int(width).int(height).byte(8).byte(6).byte(0).byte(0).byte(0).toByteArray()
        return Bytes().bytes(SIGNATURE)
            .chunk("IHDR", ihdr)
            .chunk("IDAT", zlibStored(raw))
            .chunk("IEND", ByteArray(0))
            .toByteArray()
    }

    private fun zlibStored(data: ByteArray): ByteArray {
        val out = Bytes().byte(0x78).byte(0x01)
        var pos = 0
        do {
            val len = minOf(65535, data.size - pos)
            val last = pos + len == data.size
            out.byte(if (last) 1 else 0)
            out.byte(len and 0xff).byte(len shr 8)
            out.byte(len.inv() and 0xff).byte((len.inv() shr 8) and 0xff)
            out.bytes(data.copyOfRange(pos, pos + len))
            pos += len
        } while (pos < data.size)
        return out.int(adler32(data)).toByteArray()
    }

    private fun adler32(data: ByteArray): Int {
        var a = 1
        var b = 0
        for (v in data) {
            a = (a + (v.toInt() and 0xff)) % 65521
            b = (b + a) % 65521
        }
        return (b shl 16) or a
    }

    private val crcTable = IntArray(256) { n ->
        var c = n
        repeat(8) { c = if (c and 1 != 0) (0xedb88320.toInt() xor (c ushr 1)) else c ushr 1 }
        c
    }

    private fun crc32(data: ByteArray): Int {
        var c = -1
        for (v in data) c = crcTable[(c xor v.toInt()) and 0xff] xor (c ushr 8)
        return c.inv()
    }

    private class Bytes {
        private val list = ArrayList<Byte>()
        fun byte(v: Int) = apply { list.add(v.toByte()) }
        fun bytes(v: ByteArray) = apply { v.forEach { list.add(it) } }
        fun int(v: Int) = apply { byte(v ushr 24).byte(v ushr 16).byte(v ushr 8).byte(v) }
        fun chunk(type: String, data: ByteArray) = apply {
            val typed = type.encodeToByteArray() + data
            int(data.size).bytes(typed).int(crc32(typed))
        }
        fun toByteArray() = list.toByteArray()
    }
}
