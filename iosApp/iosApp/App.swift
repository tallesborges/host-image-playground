import Shared
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = ViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

/// Plain native screen: one button per scenario, a verdict line, and the web view.
final class ViewController: UIViewController {
    /// The tests drive the app through this instance.
    static weak var current: ViewController?

    private let status = UILabel()
    private let container = UIView()
    private var runner: ProbeRunner?

    override func viewDidLoad() {
        super.viewDidLoad()
        ViewController.current = self
        view.backgroundColor = .systemBackground

        let buttons = UIStackView(arrangedSubviews: Scenarios.shared.ios.map { s in
            var config = UIButton.Configuration.bordered()
            config.title = s.label
            config.buttonSize = .small
            config.titleLineBreakMode = .byClipping
            return UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in
                Task { await self?.run(scenarioId: s.id) }
            })
        })
        buttons.spacing = 6
        buttons.translatesAutoresizingMaskIntoConstraints = false

        let bar = UIScrollView()
        bar.showsHorizontalScrollIndicator = false
        bar.addSubview(buttons)
        NSLayoutConstraint.activate([
            buttons.topAnchor.constraint(equalTo: bar.contentLayoutGuide.topAnchor),
            buttons.bottomAnchor.constraint(equalTo: bar.contentLayoutGuide.bottomAnchor),
            buttons.leadingAnchor.constraint(equalTo: bar.contentLayoutGuide.leadingAnchor),
            buttons.trailingAnchor.constraint(equalTo: bar.contentLayoutGuide.trailingAnchor),
            buttons.heightAnchor.constraint(equalTo: bar.frameLayoutGuide.heightAnchor),
        ])

        status.font = .preferredFont(forTextStyle: .footnote)
        status.numberOfLines = 0
        status.text = "Pick a scenario."

        let stack = UIStackView(arrangedSubviews: [bar, status, container])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 8),
            stack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -12),
            stack.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
        ])

        // `-scenario <id>` starts a run at launch. Tests start runs themselves.
        let underTest = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        if !underTest, let id = UserDefaults.standard.string(forKey: "scenario") {
            Task {
                await run(scenarioId: id)
                // `-demoScroll <n>`: scroll the page n times after the run, for screen recordings.
                await scrollForDemo(steps: UserDefaults.standard.integer(forKey: "demoScroll"))
            }
        }
    }

    @discardableResult
    func run(scenarioId: String, timeout: TimeInterval = 60) async -> RunOutput {
        let scenario = Scenarios.shared.ios(id: scenarioId)
        runner?.webView.removeFromSuperview()
        let runner = ProbeRunner(scenario: scenario)
        self.runner = runner

        let web = runner.webView
        web.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: container.topAnchor),
            web.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        status.text = "\(scenario.id): running…"
        let out = await runner.run(timeout: timeout)
        status.text = out.summary
        return out
    }

    private func scrollForDemo(steps: Int) async {
        guard let web = runner?.webView else { return }
        for _ in 0..<steps {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            _ = try? await web.evaluateJavaScript("window.scrollBy({top: innerHeight * 0.8, behavior: 'smooth'})")
        }
    }
}
