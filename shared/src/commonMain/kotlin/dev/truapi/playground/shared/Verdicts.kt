package dev.truapi.playground.shared

/** What the probe needs: the image to show, the read to fail, or (control) the read to work. */
enum class Want { SHOW, BLOCK, READ }

/** One row from web/probe.js. */
data class ProbeResult(
    val source: String,
    val probe: String,
    val want: Want,
    val outcome: String,
    val detail: String,
) {
    val read: Boolean get() = outcome == "READ"
    val shown: Boolean get() = outcome == "shown"

    /** The engine refused the request, so the probe could not test the read. */
    val notRun: Boolean get() = outcome == "n/a"

    /** True when the result is what [want] asks for. */
    val ok: Boolean get() = when (want) {
        Want.SHOW -> shown
        Want.BLOCK -> !read
        Want.READ -> read
    }
}

data class Verdict(
    val scenario: Scenario,
    val leaks: List<ProbeResult>,
    val displayFailures: List<ProbeResult>,
    val controlFailures: List<ProbeResult>,
    val missingSources: List<String>,
    /** Block probes that could not run (outcome `n/a`). They are not leaks and not proof of isolation. */
    val notRun: List<ProbeResult>,
) {
    val passed: Boolean get() = problems.isEmpty()

    val problems: List<String>
        get() = buildList {
            if (missingSources.isNotEmpty()) add("no results for: ${missingSources.joinToString()}")
            displayFailures.forEach { add("not shown: ${it.source} / ${it.probe}") }
            controlFailures.forEach { add("control did not read: ${it.source} / ${it.probe}") }
            when (scenario.expectation) {
                Expectation.SAFE -> leaks.forEach { add("leak: ${it.source} / ${it.probe}: ${it.detail}") }
                Expectation.LEAKS -> if (leaks.isEmpty()) add("expected a leak, found none")
            }
        }

    val summary: String
        get() = "${scenario.id}: leaks=${leaks.size} notShown=${displayFailures.size} " +
            "controlsFailed=${controlFailures.size} notRun=${notRun.size} expected=${scenario.expectation} " +
            if (passed) "PASS" else "FAIL"
}

object Verdicts {
    const val OWN_ORIGIN_SOURCE = "own origin (control)"

    fun evaluate(scenario: Scenario, results: List<ProbeResult>): Verdict {
        val supported = results.filterNot { it.probe in scenario.unsupportedProbes }
        val controls = supported.filter { it.want == Want.READ }
            .filterNot { !scenario.ownOriginReadable && it.source == OWN_ORIGIN_SOURCE }
        val seen = results.map { it.source }.toSet()
        return Verdict(
            scenario = scenario,
            leaks = results.filter { it.want == Want.BLOCK && it.read },
            displayFailures = supported.filter { it.want == Want.SHOW && !it.shown },
            controlFailures = controls.filter { !it.read },
            missingSources = (scenario.hostSources + OWN_ORIGIN_SOURCE).filterNot { it in seen },
            notRun = results.filter { it.want == Want.BLOCK && it.notRun },
        )
    }
}
