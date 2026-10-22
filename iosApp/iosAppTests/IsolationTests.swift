import XCTest
@testable import iosApp

/// Runs the web probes in a real WKWebView for each iOS scenario and checks the shared verdict.
/// Results and snapshots go to the app's Documents/results.
@MainActor
final class IsolationTests: XCTestCase {
    func testNovaLikePageCannotReadHostData() async throws { try await check("ios-nova") }
    func testHtmlStringPageCannotReadHostData() async throws { try await check("ios-https") }
    func testFilePageCannotReadHostData() async throws { try await check("ios-file") }
    func testHostSchemeOtherHostCannotReadHostData() async throws { try await check("ios-custom") }
    func testSameHostPageCanReadHostData() async throws { try await check("ios-same-host") }

    private func check(_ id: String) async throws {
        let vc = try XCTUnwrap(ViewController.current, "app screen is not loaded")
        let out = await vc.run(scenarioId: id)
        XCTAssertEqual(out.scenarioId, id)
        XCTAssertTrue(out.passed, ([out.summary] + out.problems).joined(separator: "\n"))
    }
}
