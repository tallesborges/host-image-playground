import Foundation
import Shared
import WebKit

/// Private host data on `truapi-host://`: maps WKWebView requests to the shared `HostRoutes`.
/// It also serves the diagnostic product pages on `truapi-host://app/`. The Nova-like product
/// page is served by `ProductSchemeHandler` on `polkadot://`.
/// One handler per WKWebView. `productId` is set by the host when it creates the web view,
/// never taken from a request.
/// WebKit does not let an app handle `https`, so `https://host.test` does not exist on iOS.
final class HostSchemeHandler: NSObject, WKURLSchemeHandler {
    static let beaconBase = "\(HostRoutes.companion.SCHEME)://beacon"

    let beacons: BeaconStore
    private let routes: HostRoutes
    private let webDir: URL

    init(webDir: URL, productId: String = HostContacts.shared.DEMO_PRODUCT) {
        self.webDir = webDir.standardizedFileURL
        let store = BeaconStore()
        beacons = store
        routes = HostRoutes(productId: productId, beacons: store, beaconBase: Self.beaconBase)
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        let origin = task.request.value(forHTTPHeaderField: "Origin") ?? "-"
        NSLog("TRUAPI REQ %@ %@ origin=%@", task.request.httpMethod ?? "GET", url.absoluteString, origin)

        var query: [String: String] = [:]
        for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
            query[item.name] = item.value ?? ""
        }
        let request = HostRequest(scheme: url.scheme ?? "", host: url.host ?? "", path: url.path, query: query)
        let route = routes.route(req: request)

        if let body = route as? HostRouteBody {
            respond(task, url: url, status: Int(body.status), mimeType: body.mimeType,
                    headers: body.headers, data: IosBytesKt.bodyData(body: body) as Data)
        } else if let asset = route as? HostRouteAsset {
            let file = webDir.appendingPathComponent(asset.name).standardizedFileURL
            guard file.path.hasPrefix(webDir.path + "/"), let data = try? Data(contentsOf: file) else {
                respond(task, url: url, status: 404, mimeType: "text/plain", headers: [:], data: Data())
                return
            }
            respond(task, url: url, status: 200, mimeType: HostRoutes.companion.mimeTypeFor(name: asset.name),
                    headers: ["Cache-Control": "no-store"], data: data)
        } else {
            task.didFailWithError(URLError(.unsupportedURL))
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, mimeType: String,
                         headers: [String: String], data: Data) {
        var fields = headers
        fields["Content-Type"] = mimeType.hasPrefix("image/png") ? mimeType : "\(mimeType); charset=utf-8"
        fields["Content-Length"] = String(data.count)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}

/// Records requests made by the probe SVG. Test instrumentation only.
final class BeaconStore: NSObject, BeaconLog {
    private let lock = NSLock()
    private var log: [String: [String]] = [:]

    func record(id: String, kind: String) {
        NSLog("TRUAPI BEACON %@ %@", id, kind)
        lock.lock()
        log[id, default: []].append(kind)
        lock.unlock()
    }

    func hits(id: String) -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return log[id] ?? []
    }
}
