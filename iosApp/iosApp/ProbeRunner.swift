import Shared
import UIKit
import WebKit

/// Result of one scenario run, in plain Swift types so tests do not need the Kotlin framework.
struct RunOutput {
    let scenarioId: String
    let passed: Bool
    let summary: String
    let problems: [String]
    let resultLines: [String]
    let meta: String?
}

/// Loads the product page for one scenario in a fresh WKWebView, collects probe results
/// from the page console, and checks them with the shared `Verdicts`.
@MainActor
final class ProbeRunner: NSObject {
    let scenario: Scenario
    let webView: WKWebView

    private let webDir: URL
    private let productURL: URL?
    private var results: [ProbeResult] = []
    private var lines: [String] = []
    private var meta: String?
    private var continuation: CheckedContinuation<RunOutput, Never>?
    private var finished = false

    /// Applied before probe.js runs. iOS has one host source, the custom scheme. The beacon log
    /// is read through a native bridge, because an https page cannot fetch the custom scheme.
    private static func configScript(_ s: Scenario) -> String {
        """
        self.PLAYGROUND_CONFIG = {
          sources: ['\(Scenarios.shared.SCHEME_SOURCE)'],
          fetchable: { '\(Scenarios.shared.SCHEME_SOURCE)': \(s.schemeFetchable) },
          beaconHits: id => webkit.messageHandlers.beacons.postMessage(id)
        };
        """
    }

    /// WKWebView has no console callback, so the page console is forwarded to native.
    private static let consoleScript = """
    (function () {
      const post = m => { try { webkit.messageHandlers.console.postMessage(String(m)); } catch (e) {} };
      const log = console.log.bind(console);
      console.log = (...a) => { post(a.join(' ')); log(...a); };
      addEventListener('error', e => post('JSERROR ' + e.message));
    })();
    """

    init(scenario: Scenario) {
        self.scenario = scenario
        let webDir = Bundle.main.url(forResource: "web", withExtension: nil)!
        self.webDir = webDir

        // Two handlers, both bound to one product when the web view is created:
        // product files on `polkadot://` (like the Nova host), private data on `truapi-host://`.
        let productId = HostContacts.shared.DEMO_PRODUCT
        let handler = HostSchemeHandler(webDir: webDir, productId: productId)
        let products = ProductSchemeHandler(productId: productId, contentDir: webDir)
        productURL = products.getProductUrl()

        // Same configuration as the Nova iOS host (polkadot-ios-community, SPAViewController.loadView), plus the
        // private-data handler. Default website data store, as there.
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(products, forURLScheme: ProductSchemeHandler.scheme)
        config.setURLSchemeHandler(handler, forURLScheme: HostRoutes.companion.SCHEME)
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: Self.configScript(scenario), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.consoleScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = content
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        content.add(WeakMessageHandler(self), name: "console")
        content.addScriptMessageHandler(BeaconBridge(handler.beacons), contentWorld: .page, name: "beacons")
        if #available(iOS 16.4, *) { webView.isInspectable = true }
    }

    func run(timeout: TimeInterval = 60) async -> RunOutput {
        NSLog("TRUAPI SCENARIO %@ page=%@ ios=%@", scenario.id, scenario.page.name, UIDevice.current.systemVersion)
        return await withCheckedContinuation { c in
            continuation = c
            load()
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                await self.complete(extraProblem: "page did not report DONE in \(Int(timeout))s")
            }
        }
    }

    private func load() {
        let page = scenario.page
        if page == PageKind.productPolkadot {
            // Like SPAViewController.navigate(to:): a URLRequest for polkadot://<productId>/index.html.
            guard let url = productURL else {
                Task { await complete(extraProblem: "no product URL") }
                return
            }
            webView.load(URLRequest(url: url))
        } else if page == PageKind.productHttps {
            // Diagnostic only. Nova does not load products this way.
            // WebKit cannot intercept https, so the page HTML is given with an https base URL.
            // Its relative files would go to the network, so CSS and JS are inlined.
            guard let html = inlinedIndex() else {
                Task { await complete(extraProblem: "web/index.html no longer has the expected style/script tags") }
                return
            }
            webView.loadHTMLString(html, baseURL: URL(string: scenario.pageUrl!)!)
        } else if page == PageKind.file {
            webView.loadFileURL(webDir.appendingPathComponent("index.html"), allowingReadAccessTo: webDir)
        } else {
            webView.load(URLRequest(url: URL(string: scenario.pageUrl!)!))
        }
    }

    private func inlinedIndex() -> String? {
        func read(_ name: String) -> String? {
            try? String(contentsOf: webDir.appendingPathComponent(name), encoding: .utf8)
        }
        let styleTag = #"<link rel="stylesheet" href="style.css">"#
        let scriptTag = #"<script src="probe.js"></script>"#
        guard let html = read("index.html"), let css = read("style.css"), let js = read("probe.js"),
              html.contains(styleTag), html.contains(scriptTag), !js.contains("</script") else { return nil }
        return html
            .replacingOccurrences(of: styleTag, with: "<style>\(css)</style>")
            .replacingOccurrences(of: scriptTag, with: "<script>\(js)</script>")
    }

    fileprivate func onConsole(_ text: String) {
        NSLog("TRUAPI JS %@", text)
        if text.hasPrefix("RESULT ") {
            let json = String(text.dropFirst("RESULT ".count))
            lines.append(json)
            if let r = Self.parse(json) { results.append(r) }
        } else if text.hasPrefix("META ") {
            meta = String(text.dropFirst("META ".count))
        } else if text.hasPrefix("DONE ") || text.hasPrefix("FATAL ") {
            Task { await complete(extraProblem: text.hasPrefix("FATAL ") ? text : nil) }
        }
    }

    private func complete(extraProblem: String?) async {
        guard !finished else { return }
        finished = true
        let verdict = Verdicts.shared.evaluate(scenario: scenario, results: results)
        let problems = verdict.problems + (extraProblem.map { [$0] } ?? [])
        let passed = verdict.passed && extraProblem == nil
        let summary = extraProblem.map { "\(scenario.id): FAIL: \($0)" } ?? verdict.summary
        NSLog("TRUAPI VERDICT %@", summary)
        problems.forEach { NSLog("TRUAPI PROBLEM %@", $0) }

        let output = RunOutput(scenarioId: scenario.id, passed: passed, summary: summary,
                               problems: problems, resultLines: lines, meta: meta)
        await save(output)
        continuation?.resume(returning: output)
        continuation = nil
    }

    /// Writes results to Documents/results, like the Android test does.
    private func save(_ out: RunOutput) async {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("results", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let id = out.scenarioId
        try? (out.resultLines.joined(separator: "\n") + "\n")
            .write(to: dir.appendingPathComponent("\(id).jsonl"), atomically: true, encoding: .utf8)
        let text = ([out.summary, "meta=\(out.meta ?? "-")", "ios=\(UIDevice.current.systemVersion)"]
            + out.problems.map { "problem: \($0)" }).joined(separator: "\n") + "\n"
        try? text.write(to: dir.appendingPathComponent("\(id).verdict.txt"), atomically: true, encoding: .utf8)
        if webView.window != nil, let image = try? await webView.takeSnapshot(configuration: nil),
           let png = image.pngData() {
            try? png.write(to: dir.appendingPathComponent("\(id).png"))
        }
    }

    private static func parse(_ json: String) -> ProbeResult? {
        guard let data = json.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let source = o["source"] as? String, let probe = o["probe"] as? String,
              let wantText = o["want"] as? String, let outcome = o["outcome"] as? String else { return nil }
        let want: Want
        switch wantText {
        case "show": want = .show
        case "read": want = .read
        default: want = .block
        }
        return ProbeResult(source: source, probe: probe, want: want, outcome: outcome,
                           detail: o["detail"] as? String ?? "")
    }
}

/// Test instrumentation: lets probe.js read which beacons the probe SVG sent.
private final class BeaconBridge: NSObject, WKScriptMessageHandlerWithReply {
    let beacons: BeaconStore
    init(_ beacons: BeaconStore) { self.beacons = beacons }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        replyHandler(beacons.hits(id: message.body as? String ?? ""), nil)
    }
}

/// Breaks the retain cycle WKUserContentController -> handler -> web view.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var runner: ProbeRunner?
    init(_ runner: ProbeRunner) { self.runner = runner }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String else { return }
        MainActor.assumeIsolated { runner?.onConsole(text) }
    }
}
