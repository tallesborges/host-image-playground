import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the product's own files on `polkadot://<productId>/`, like `ProductScriptSchemeHandler`
/// in the Nova iOS host (polkadot-ios-community,
/// Packages/Products/Sources/Products/Services/ProductScriptSchemeHandler.swift).
///
/// The real host serves the product archive it downloaded from DotNS. Here the files are the
/// synthetic product in `web/`, bundled with the app. There is no DotNS lookup and no download.
///
/// Same URL shape, lookup order, and response as the real handler: status 200 with only
/// `Content-Type` and `Content-Length`, and `didFailWithError` for a missing file.
/// It serves product files only. Private host data has its own handler (`HostSchemeHandler`).
final class ProductSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "polkadot"
    static let defaultMimeType = "application/octet-stream"

    private let productId: String
    private let entryRelativePath: String
    private let contentDir: URL

    init(productId: String, entryRelativePath: String = "index.html", contentDir: URL) {
        self.productId = productId
        self.entryRelativePath = entryRelativePath
        self.contentDir = contentDir.standardizedFileURL
    }

    func getBaseUrl() -> URL? {
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = productId
        components.path = "/"
        return components.url
    }

    func getProductUrl() -> URL? {
        getBaseUrl()?.appendingPathComponent(entryRelativePath)
    }

    func webView(_: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        NSLog("TRUAPI PRODUCT %@", url.absoluteString)

        let path = url.path
        let requestedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path

        // The real handler is bound to one product; it serves files for that product ID only.
        guard url.host == productId, let resolved = resolveContent(for: requestedPath) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let pathExtension = (resolved.relativePath as NSString).pathExtension
        let contentType = UTType(filenameExtension: pathExtension)?.preferredMIMEType ?? Self.defaultMimeType
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": contentType, "Content-Length": "\(resolved.data.count)"]
        )!
        task.didReceive(response)
        task.didReceive(resolved.data)
        task.didFinish()
    }

    func webView(_: WKWebView, stop _: WKURLSchemeTask) {}

    private func resolveContent(for requestedPath: String) -> (relativePath: String, data: Data)? {
        guard !requestedPath.isEmpty else { return loadContent(at: entryRelativePath) }
        if let exact = loadContent(at: requestedPath) { return exact }
        guard !requestedPath.contains(".") else { return nil }
        let directory = requestedPath.hasSuffix("/") ? requestedPath : requestedPath + "/"
        return loadContent(at: directory + entryRelativePath) ?? loadContent(at: entryRelativePath)
    }

    private func loadContent(at relativePath: String) -> (relativePath: String, data: Data)? {
        let file = contentDir.appendingPathComponent(relativePath).standardizedFileURL
        guard file.path.hasPrefix(contentDir.path + "/"), let data = try? Data(contentsOf: file) else { return nil }
        return (relativePath, data)
    }
}
