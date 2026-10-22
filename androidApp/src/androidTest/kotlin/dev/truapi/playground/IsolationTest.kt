package dev.truapi.playground

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.truapi.playground.shared.Scenario
import dev.truapi.playground.shared.Scenarios
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Runs the web probes in a real WebView for each scenario and checks the shared verdict.
 * Results and screenshots go to the app's external files dir, under results/.
 */
@RunWith(AndroidJUnit4::class)
class IsolationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val outDir = File(context.getExternalFilesDir(null), "results").apply { mkdirs() }

    @Test fun novaLikePageCannotReadHostData() = run(Scenarios.NOVA)
    @Test fun httpsTestPageCannotReadHostData() = run(Scenarios.HTTPS)
    @Test fun strictFilePageCannotReadHostData() = run(Scenarios.FILE_STRICT)
    @Test fun customSchemePageCanReadHostData() = run(Scenarios.CUSTOM)
    @Test fun universalFileAccessCanReadHostData() = run(Scenarios.FILE_UNIVERSAL)

    private fun run(s: Scenario) {
        ProbeRun.current = null
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_SCENARIO, s.id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        ActivityScenario.launch<MainActivity>(intent).use {
            val run = waitForRun(s)
            val verdict = run.await(TIMEOUT_S)
            SystemClock.sleep(500)
            save(s, run)
            assertNotNull("${s.id}: page did not report DONE in ${TIMEOUT_S}s", verdict)
            assertTrue(verdict!!.problems.joinToString("\n", "${verdict.summary}\n"), verdict.passed)
        }
    }

    private fun waitForRun(s: Scenario): ProbeRun {
        val end = SystemClock.uptimeMillis() + 10_000
        while (SystemClock.uptimeMillis() < end) {
            ProbeRun.current?.takeIf { it.scenario == s }?.let { return it }
            SystemClock.sleep(50)
        }
        error("${s.id}: activity did not start a probe run")
    }

    private fun save(s: Scenario, run: ProbeRun) {
        File(outDir, "${s.id}.jsonl").writeText(run.rawLines.joinToString("\n", postfix = "\n"))
        File(outDir, "${s.id}.verdict.txt").writeText(
            buildString {
                appendLine(run.verdict?.summary ?: "${s.id}: no verdict")
                appendLine("meta=${run.meta}")
                run.verdict?.problems?.forEach { appendLine("problem: $it") }
            },
        )
        instrumentation.uiAutomation.takeScreenshot()?.let { bmp ->
            File(outDir, "${s.id}.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    companion object {
        const val TIMEOUT_S = 120L
    }
}
