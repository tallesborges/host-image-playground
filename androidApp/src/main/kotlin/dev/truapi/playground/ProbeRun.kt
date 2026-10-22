package dev.truapi.playground

import dev.truapi.playground.shared.ProbeResult
import dev.truapi.playground.shared.Scenario
import dev.truapi.playground.shared.Verdict
import dev.truapi.playground.shared.Verdicts
import dev.truapi.playground.shared.Want
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Collects probe results from the page console for one scenario run. */
class ProbeRun(val scenario: Scenario) {
    val results: MutableList<ProbeResult> = mutableListOf()
    val rawLines: MutableList<String> = mutableListOf()
    var meta: String? = null
    @Volatile var verdict: Verdict? = null
    private val done = CountDownLatch(1)

    /** Returns the verdict when the page reports DONE. */
    fun onConsole(message: String): Verdict? {
        when {
            message.startsWith("RESULT ") -> {
                val json = message.removePrefix("RESULT ")
                rawLines += json
                results += parse(JSONObject(json))
            }
            message.startsWith("META ") -> meta = message.removePrefix("META ")
            message.startsWith("DONE ") || message.startsWith("FATAL ") -> {
                val v = Verdicts.evaluate(scenario, results.toList())
                verdict = v
                done.countDown()
                return v
            }
        }
        return null
    }

    fun await(seconds: Long): Verdict? = if (done.await(seconds, TimeUnit.SECONDS)) verdict else null

    private fun parse(o: JSONObject) = ProbeResult(
        source = o.getString("source"),
        probe = o.getString("probe"),
        want = Want.valueOf(o.getString("want").uppercase()),
        outcome = o.getString("outcome"),
        detail = o.optString("detail"),
    )

    companion object {
        @Volatile var current: ProbeRun? = null
    }
}
