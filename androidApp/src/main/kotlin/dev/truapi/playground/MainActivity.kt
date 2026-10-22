package dev.truapi.playground

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import dev.truapi.playground.HostWebViewClient.Companion.TAG
import dev.truapi.playground.shared.Scenario
import dev.truapi.playground.shared.Scenarios

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var status: TextView

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        WebView.setWebContentsDebuggingEnabled(true)

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            Scenarios.android.forEach { s ->
                addView(Button(this@MainActivity).apply {
                    text = s.label
                    isAllCaps = false
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                    setOnClickListener { load(s) }
                }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            }
        }
        status = TextView(this).apply {
            setPadding(dp(16), dp(4), dp(16), dp(4))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.rgb(27, 31, 36))
        }
        web = WebView(this).apply {
            webViewClient = HostWebViewClient(this@MainActivity)
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    val text = m.message()
                    Log.i(TAG, "JS $text")
                    ProbeRun.current?.onConsole(text)?.let { v ->
                        Log.i(TAG, "VERDICT ${v.summary}")
                        v.problems.forEach { Log.i(TAG, "PROBLEM $it") }
                        runOnUiThread { status.text = v.summary }
                    }
                    return true
                }
            }
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            fitsSystemWindows = true
            addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(status, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(web, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        })

        load(Scenarios.android(intent.getStringExtra(EXTRA_SCENARIO)))
    }

    private fun load(s: Scenario) {
        ProbeRun.current = ProbeRun(s)
        status.text = "${s.id}: running…"
        // Same JS, DOM storage, file, and content settings as the Nova Android host
        // (polkadot-android-community, BrowserWebViewProvider.createWebView). That host also turns off
        // mediaPlaybackRequiresUserGesture; this playground leaves it at the default.
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowContentAccess = false
            // Nova: false. Only the file:///android_asset diagnostic pages turn it on.
            allowFileAccess = s.fileAccess
            // Not set by Nova (default false). On only in file-universal, the worst case.
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = s.fileUrlAccess
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = s.fileUrlAccess
        }
        val url = s.pageUrl ?: "file:///android_asset/index.html"
        val wv = WebView.getCurrentWebViewPackage()
        Log.i(
            TAG,
            "SCENARIO ${s.id} url=$url sdk=${Build.VERSION.SDK_INT} release=${Build.VERSION.RELEASE} " +
                "model=${Build.MODEL} webview=${wv?.packageName}/${wv?.versionName} " +
                "fileAccess=${s.fileAccess} fileUrlAccess=${s.fileUrlAccess}",
        )
        web.loadUrl(url)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_SCENARIO = "scenario"
    }
}
