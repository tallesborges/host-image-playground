package dev.truapi.playground.shared

import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSData
import platform.Foundation.create

/** Copies the body bytes into NSData for WKURLSchemeTask, without a per-byte loop in Swift. */
@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
fun bodyData(body: HostRoute.Body): NSData {
    val bytes = body.bytes
    if (bytes.isEmpty()) return NSData()
    return bytes.usePinned { NSData.create(bytes = it.addressOf(0), length = bytes.size.toULong()) }
}
